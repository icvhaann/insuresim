// server.js
// InsureSim v3 — adds:
//   • hidden insurance-need layer (medical vs critical illness, randomly assigned)
//   • pitch classification + wrong-close detection (mis-sell outcome)
//   • HTML log export (per-session & facilitator)
//   • token-gated facilitator cheatsheet route
//
// Server-side prompt assembly remains. Never expose the persona/need to the client.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import rateLimit from 'express-rate-limit';

import { ARCHETYPES, pickArchetype } from './src/personas.js';
import { INSURANCE_NEEDS, pickInsuranceNeed, classifySellerPitch, classifyProbeDirection, isSellerCloseAttempt } from './src/insuranceNeeds.js';
import { buildSystemPrompt, getTurnInstruction, preScoreMessage } from './src/prompts.js';
import {
  detectSevere, detectConfirmingQ, detectPrivate, detectLegitimacy,
  isInsuranceMention, isOptOut, insuranceWalkProbability, isUserClose,
} from './src/breaches.js';
import { judgeBreach, judgeTransition, judgeKeyMoments, generateExemplar, judgeNeedDiscovery } from './src/judges.js';
import { createSession, logTurn, endSession, getSession, exportAll, attachDebrief } from './src/audit.js';
import { scoreTurn } from './src/scoring.js';
import { renderSessionPage, renderAllSessionsPage } from './src/logExport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT              = process.env.PORT || 3000;
const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const ADMIN_TOKEN       = process.env.ADMIN_TOKEN || null;
const DEEPSEEK_URL      = 'https://api.deepseek.com/v1/chat/completions';

if (!DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set in environment.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

// ─── Health / warmup ──────────────────────────────────────────────
app.get('/api/warmup', (_req, res) => res.json({ ok: true, model: DEEPSEEK_MODEL }));

// ─── Session start: assigns archetype + insurance need ────────────
app.post('/api/session/start', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'Invalid sessionId.' });
  }
  const archetypeKey     = pickArchetype();
  const insuranceNeedKey = pickInsuranceNeed();
  createSession(sessionId, archetypeKey, insuranceNeedKey);
  const arch = ARCHETYPES[archetypeKey];
  // Archetype + need hidden until debrief.
  res.json({ ok: true, initialPsych: arch.initialPsych });
});

// ─── Chat: server assembles prompt, calls model, returns reply ────
app.post('/api/chat', async (req, res) => {
  const {
    sessionId, stage, userMessage, history,
    psych, memory, totalTurns, insuranceMentionTurn,
    discoveryLevel, wrongCloseCount, latestSpecificPitch,
  } = req.body || {};

  if (!sessionId || typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const session = getSession(sessionId);
  const archetypeKey      = session?.archetypeKey || 'default';
  const insuranceNeedKey  = session?.insuranceNeedKey || 'medical';
  const userMsg = userMessage.slice(0, 2000);
  const trimmedHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000),
    }));

  // ─── Pre-flight detection ─────────────────────────────────────
  const severe       = detectSevere(userMsg);
  const confirmingQs = detectConfirmingQ(userMsg);
  const privateRefs  = detectPrivate(userMsg);
  const insuranceNow = isInsuranceMention(userMsg);

  const pitchType       = classifySellerPitch(userMsg);       // 'medical' | 'critical_illness' | 'both' | 'generic' | null
  const probeDirection  = classifyProbeDirection(userMsg);    // 'medical' | 'critical_illness' | 'both' | 'neutral'
  const sellerClosing   = isSellerCloseAttempt(userMsg);

  // What is the "most recent specific pitch type" the seller has settled on?
  // Priority: this-turn specific > prior tracked.
  let effectivePitchType = latestSpecificPitch || null;
  if (pitchType === 'medical' || pitchType === 'critical_illness') {
    effectivePitchType = pitchType;
  } else if (pitchType === 'both' && !effectivePitchType) {
    effectivePitchType = 'both';
  }

  const wrongPitch = (pitchType === 'medical' || pitchType === 'critical_illness')
    && pitchType !== insuranceNeedKey;
  const wrongCloseAttempt = sellerClosing
    && effectivePitchType
    && effectivePitchType !== 'generic'
    && effectivePitchType !== 'both'
    && effectivePitchType !== insuranceNeedKey;

  // Alignment signals (client uses these to update discovery / memory / outcome
  // gating WITHOUT learning what the hidden need is).
  const probeAligned = probeDirection === insuranceNeedKey || probeDirection === 'both';
  const pitchAligned = pitchType === insuranceNeedKey || pitchType === 'both';
  const discoveryIncrement = probeAligned ? 1 : 0;

  // Does the running-latest specific pitch match the need? Used by the client at
  // close-signal time to decide success vs. failed_missold.
  //   true  → latest specific pitch matches need (success if Ivan closes)
  //   false → latest specific pitch is the WRONG type (failed_missold)
  //   null  → no specific pitch yet, or only 'both' / 'generic'
  let latestSpecificPitchAligned = null;
  if (effectivePitchType === 'medical' || effectivePitchType === 'critical_illness') {
    latestSpecificPitchAligned = effectivePitchType === insuranceNeedKey;
  }

  // ─── Insurance walk-away dice roll (only on FIRST mention) ────
  let walkAway = false;
  let walkPresentation = null;
  if (insuranceNow && !insuranceMentionTurn) {
    const turnIdx = (totalTurns || 0) + 1;
    const pWalk = insuranceWalkProbability(turnIdx, psych?.trust ?? 50);
    if (Math.random() < pWalk) {
      walkAway = true;
      walkPresentation = Math.random() < 0.5 ? 'overlay_only' : 'cold_reply';
    }
  }

  // ─── Walk-away with overlay-only: skip API ────────────────────
  if (walkAway && walkPresentation === 'overlay_only') {
    logTurn(sessionId, {
      turn: (totalTurns || 0) + 1,
      stage,
      userMessage: userMsg,
      severeBreach: severe.map(s => s.label),
      privateRefs:  privateRefs.map(p => p.label),
      confirmingQ:  confirmingQs.map(c => c.label),
      insuranceMention: true,
      pitchType,
      probeDirection,
      walked: true,
      walkPresentation,
      reply: null,
      thought: '[Ivan walked silently — insurance mentioned too early]',
      ignored: true,
    });
    return res.json({
      reply: null,
      ignored: true,
      walked: true,
      walkPresentation: 'overlay_only',
      severeBreach: severe[0] || null,
      privateRefs,
      confirmingQ: confirmingQs,
      insuranceMention: true,
      legitimacy: null,
      optOut: false,
      pitchType,
      probeDirection,
      effectivePitchType,
      sellerClosing,
      wrongPitch: false,
      wrongCloseAttempt: false,
      probeAligned: false,
      pitchAligned: false,
      latestSpecificPitchAligned: null,
      discoveryIncrement: 0,
    });
  }

  // ─── Breach-judge fallback trigger ────────────────────────────
  const adjacentRe = /\b(your|you).{0,30}\b(weekend|morning|run|gym|trail|friend|ski|knee|ankle|injur|niseko|hokkaido|tai\s*tam|quarry|MPF|tax|salary|saving|spend|coverage|insurer)\b/i;
  const shouldJudge = severe.length === 0
    && privateRefs.length === 0
    && userMsg.length > 60
    && adjacentRe.test(userMsg);

  // ─── Quality + turn instruction ───────────────────────────────
  const quality = preScoreMessage(userMsg, stage, insuranceNow, insuranceNeedKey);
  const turnInstruction = getTurnInstruction({
    stage,
    quality,
    psych: psych || {},
    severeBreach: severe[0] || null,
    walkAway,
    totalTurns: totalTurns || 0,
    wrongPitch,
    wrongCloseAttempt,
  });

  const system = buildSystemPrompt({
    archetypeKey,
    insuranceNeedKey,
    stage,
    psych: psych || {},
    memory: memory || {},
    turnInstruction,
    totalTurns: totalTurns || 0,
    insuranceMentioned: !!insuranceMentionTurn || insuranceNow,
    insuranceMentionTurn: insuranceMentionTurn || (insuranceNow ? (totalTurns || 0) + 1 : null),
    discoveryLevel: discoveryLevel || 0,
  });

  const messages = [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user',   content: userMsg },
  ];

  const callPersona = fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      stream: false,
      messages,
      max_tokens: 400,
      temperature: 0.85,
      response_format: { type: 'json_object' },
    }),
  });

  const callJudgeP = shouldJudge
    ? judgeBreach({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, sellerMessage: userMsg })
    : Promise.resolve(null);

  let personaResp, judgeResp;
  try {
    [personaResp, judgeResp] = await Promise.all([callPersona, callJudgeP]);
  } catch (err) {
    console.error('Persona/judge call failed:', err.message);
    return res.status(500).json({ error: 'AI service error.' });
  }

  if (!personaResp.ok) {
    let errBody = '';
    try { errBody = await personaResp.text(); } catch {}
    console.error('DeepSeek persona', personaResp.status, errBody.slice(0, 200));
    return res.status(personaResp.status === 429 ? 429 : 500)
      .json({ error: personaResp.status === 429 ? 'Rate limit.' : 'AI service error.' });
  }

  const personaData = await personaResp.json();
  const rawContent = personaData.choices?.[0]?.message?.content || '';

  // ─── Robust JSON parse ────────────────────────────────────────
  let parsed = null;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const m = rawContent.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  if (!parsed) {
    parsed = { thought: '[parse failure — model did not return valid JSON]', reply: rawContent.slice(0, 200), ignoring_reason: '' };
  }

  // ─── Post-process reply (strip sentinel strings) ──────────────
  let reply = parsed.reply;
  let ignored = false;
  let ignoringReason = parsed.ignoring_reason || '';

  if (reply === null || reply === undefined) {
    ignored = true;
    reply = null;
  } else if (typeof reply !== 'string') {
    reply = String(reply);
  }

  if (typeof reply === 'string') {
    const stripped = reply.trim();
    const sentinelRe = /^\s*\[?\s*(no\s*reply|no\s*response|ignored|ignoring|silence|no\s*comment|null|n\/a|nothing|message\s*ignored|skip|skipped|empty)\s*\]?\s*\.?\s*$/i;
    const punctOnly  = /^[\s.!?,;:\-_*…"'()[\]{}]{0,8}$/;
    if (!stripped || sentinelRe.test(stripped) || punctOnly.test(stripped)) {
      ignored = true;
      reply = null;
      if (!ignoringReason) ignoringReason = 'model returned empty/sentinel placeholder';
    }
  }

  // ─── Judge override ───────────────────────────────────────────
  let judgeBreachDetected = null;
  if (judgeResp?.breach === true) {
    judgeBreachDetected = {
      label: judgeResp.fact_referenced || 'private fact (judge-detected)',
      explanation: judgeResp.explanation || '',
    };
  }

  // ─── Detect signals in Ivan's reply ───────────────────────────
  const legitimacy = reply ? detectLegitimacy(reply) : null;
  const optOut     = reply ? isOptOut(reply) : false;
  const ivanClose  = reply ? isUserClose(reply) : false;

  // ─── Score this turn ──────────────────────────────────────────
  const score = scoreTurn({
    userMsg,
    ivanReply: reply,
    stage,
    quality,
    signals: {
      severeBreach: severe[0] || judgeBreachDetected,
      privateRefs,
      confirmingQ: confirmingQs,
    },
    alignment: {
      probeDirection,
      pitchType,
      needKey: insuranceNeedKey,
      wrongClose: wrongCloseAttempt,
    },
  });

  // ─── Audit log ────────────────────────────────────────────────
  logTurn(sessionId, {
    turn: (totalTurns || 0) + 1,
    stage,
    userMessage: userMsg,
    quality,
    score,
    severeBreach: severe.map(s => s.label),
    privateRefs: privateRefs.map(p => p.label),
    confirmingQ: confirmingQs.map(c => c.label),
    judgeBreach: judgeBreachDetected,
    insuranceMention: insuranceNow,
    pitchType,
    probeDirection,
    sellerClosing,
    wrongPitch,
    wrongCloseAttempt,
    walked: walkAway,
    walkPresentation,
    thought: parsed.thought,
    reply,
    ignored,
    ignoringReason,
    legitimacy: legitimacy?.type || null,
    optOut,
    ivanClose,
    psychSnapshot: psych || {},
  });

  res.json({
    reply: ignored ? null : reply,
    ignored,
    walked: walkAway,
    walkPresentation,
    severeBreach: severe[0] || judgeBreachDetected || null,
    privateRefs,
    confirmingQ: confirmingQs,
    insuranceMention: insuranceNow,
    legitimacy,
    optOut,
    quality,
    score,
    // Insurance-need-layer signals (client uses these for state + outcome gating)
    pitchType,
    probeDirection,
    effectivePitchType,
    sellerClosing,
    wrongPitch,
    wrongCloseAttempt,
    probeAligned,
    pitchAligned,
    latestSpecificPitchAligned,
    discoveryIncrement,
    ivanClose,
  });
});

// ─── Session end (records outcome to audit) ───────────────────────
app.post('/api/session/end', (req, res) => {
  const { sessionId, outcome, finalState } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'Invalid sessionId.' });
  endSession(sessionId, outcome, finalState);
  res.json({ ok: true });
});

// ─── Debrief: runs end-of-session judges, returns full debrief ────
app.post('/api/session/debrief', async (req, res) => {
  const { sessionId, transcript, stageScores, outcome } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'Invalid sessionId.' });
  const session = getSession(sessionId);
  const archetypeKey     = session?.archetypeKey || 'default';
  const insuranceNeedKey = session?.insuranceNeedKey || 'medical';
  const arch = ARCHETYPES[archetypeKey];
  const need = INSURANCE_NEEDS[insuranceNeedKey];

  const [transitionResult, momentsResult, exemplarResult, needResult] = await Promise.all([
    judgeTransition   ({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    judgeKeyMoments   ({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    generateExemplar  ({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [], archetypeName: arch.name, insuranceNeedName: need.shortName, insuranceNeedOneLiner: need.oneLiner }),
    judgeNeedDiscovery({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [], insuranceNeedName: need.shortName, insuranceNeedOneLiner: need.oneLiner }),
  ]);

  const debrief = {
    archetype:      { name: arch.name, description: arch.description },
    insuranceNeed:  { name: need.shortName, description: need.oneLiner, key: insuranceNeedKey },
    stageScores:    stageScores || {},
    transition:     transitionResult,
    keyMoments:     momentsResult,
    exemplarBridge: exemplarResult,
    needDiscovery:  needResult,
    outcome:        outcome || session?.outcome || 'unknown',
  };

  attachDebrief(sessionId, debrief);
  res.json(debrief);
});

// ─── Per-session HTML log download (no auth — sessionId is a random secret) ─
app.get('/api/session/log', (req, res) => {
  const { sessionId } = req.query || {};
  if (!sessionId) return res.status(400).send('Missing sessionId.');
  const session = getSession(sessionId);
  if (!session) return res.status(404).send('Session not found or expired.');
  const html = renderSessionPage(session);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="insuresim-${sessionId}.html"`);
  res.send(html);
});

// ─── Facilitator full HTML export (token-gated) ───────────────────
app.get('/api/admin/log', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).send('Admin export disabled (no ADMIN_TOKEN set).');
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).send('Unauthorized.');
  const html = renderAllSessionsPage(exportAll());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="insuresim-facilitator-${new Date().toISOString().slice(0, 10)}.html"`);
  res.send(html);
});

// ─── JSON fallback (facilitator — raw data, for debugging) ────────
app.get('/api/admin/log.json', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin export disabled (no ADMIN_TOKEN set).' });
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized.' });
  res.json(exportAll());
});

// ─── Facilitator cheatsheet (token-gated HTML render of the markdown) ──
app.get('/facilitator', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).send('Facilitator cheatsheet disabled (no ADMIN_TOKEN set).');
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).send('Unauthorized. Append ?token=...');
  const mdPath = join(__dirname, 'docs', 'FACILITATOR_CHEATSHEET.md');
  if (!existsSync(mdPath)) return res.status(404).send('Cheatsheet file missing.');
  const md = readFileSync(mdPath, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderMarkdownPage('Facilitator Cheatsheet', md));
});

// Minimal markdown-to-HTML (headings, lists, bold, italics, code, paragraphs, hr, blockquote).
function renderMarkdownPage(title, md) {
  const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^#{1,6}\s/.test(ln)) {
      const lvl = ln.match(/^#+/)[0].length;
      out.push(`<h${lvl}>${inline(ln.replace(/^#+\s/, ''))}</h${lvl}>`);
      i++;
    } else if (/^\s*[-*]\s/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join('')}</ul>`);
    } else if (/^\s*\d+\.\s/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join('')}</ol>`);
    } else if (/^\s*>\s?/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(inline(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      out.push(`<blockquote>${buf.join('<br>')}</blockquote>`);
    } else if (/^\s*---\s*$/.test(ln)) {
      out.push('<hr>'); i++;
    } else if (/^\|(.+)\|\s*$/.test(ln) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      // Simple pipe table
      const header = ln.trim().slice(1, -1).split('|').map(c => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map(c => c.trim()));
        i++;
      }
      out.push(
        `<table class="md-table"><thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
    } else if (ln.trim() === '') {
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
        buf.push(inline(lines[i]));
        i++;
      }
      out.push(`<p>${buf.join(' ')}</p>`);
    }
  }
  function inline(s) {
    let out = esc(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return out;
  }
  const css = `
    body { font-family: -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background: #fafaf7; color: #1a1a18; margin: 0; padding: 48px 32px 80px; }
    main { max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #e5e4dd; padding: 40px; border-radius: 10px; }
    h1 { border-bottom: 2px solid #1a1a18; padding-bottom: 10px; font-size: 26px; }
    h2 { margin-top: 36px; font-size: 18px; text-transform: uppercase; letter-spacing: 0.05em; color: #1a1a18; border-bottom: 1px solid #e5e4dd; padding-bottom: 6px; }
    h3 { margin-top: 24px; font-size: 15px; }
    h4 { margin-top: 18px; font-size: 14px; color: #5f5f58; }
    p, li { font-size: 15px; line-height: 1.6; }
    code { background: #f5f5ee; padding: 1px 6px; border-radius: 3px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
    blockquote { border-left: 3px solid #1a1a18; background: #f5f5ee; padding: 10px 16px; margin: 12px 0; font-style: italic; color: #3c3c3a; }
    .md-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    .md-table th, .md-table td { border-bottom: 1px solid #e5e4dd; padding: 8px 10px; text-align: left; vertical-align: top; }
    .md-table th { background: #f5f5ee; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    hr { border: 0; border-top: 1px solid #e5e4dd; margin: 32px 0; }
    ul, ol { padding-left: 24px; }
    .brand { font-weight: 600; font-size: 14px; color: #5f5f58; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 20px; }
  `;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — InsureSim</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main><div class="brand">InsureSim / Facilitator-only</div>${out.join('\n')}</main></body></html>`;
}

// ─── SPA fallback (must be LAST) ──────────────────────────────────
app.get('/', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`InsureSim v3 running on port ${PORT}`);
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  console.log(`Admin export + facilitator cheatsheet: ${ADMIN_TOKEN ? 'enabled' : 'disabled'}`);
});
