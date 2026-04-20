// server.js — InsureSim v4
//
// Adds over v3:
//   • 5-cover catalog (covers.js) replaces 2-need model
//   • Explicit session state machine with exit-intent hard guards
//   • Two-layer grounding validator (regex + LLM) with one regenerate pass
//   • 25/75 disclosure permission mechanic
//   • Ivan-revealed-fact tracking (server-side)
//
// All prompt construction remains server-side. Client never sees the cover key.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import rateLimit from 'express-rate-limit';

import { ARCHETYPES, pickArchetype } from './src/personas.js';
import { COVERS, COVER_KEYS, pickCover, classifySellerPitch, classifyProbeDirection, isSellerCloseAttempt } from './src/covers.js';
import { buildSystemPrompt, getTurnInstruction, preScoreMessage, computeDisclosurePermission } from './src/prompts.js';
import {
  detectSevere, detectConfirmingQ, detectPrivate, detectLegitimacy,
  isInsuranceMention, isOptOut, isExitIntent, insuranceWalkProbability, isUserClose,
} from './src/breaches.js';
import { judgeBreach, judgeTransition, judgeKeyMoments, generateExemplar, judgeNeedDiscovery } from './src/judges.js';
import { createSession, logTurn, endSession, getSession, exportAll, attachDebrief } from './src/audit.js';
import { scoreTurn } from './src/scoring.js';
import { regexGroundingCheck, llmGroundingCheck, shouldValidateLLM } from './src/validator.js';
import {
  SESSION_STATES, transition as smTransition,
  evaluateRecoveryAttempt, canAdvanceStage,
} from './src/stateMachine.js';
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

// Warmup
app.get('/api/warmup', (_req, res) => res.json({ ok: true, model: DEEPSEEK_MODEL }));

// ─── Session start: assigns archetype + cover (independent random) ─
app.post('/api/session/start', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'Invalid sessionId.' });
  }
  const archetypeKey = pickArchetype();
  const coverKey     = pickCover();
  createSession(sessionId, archetypeKey, coverKey);
  const arch = ARCHETYPES[archetypeKey];
  res.json({ ok: true, initialPsych: arch.initialPsych });
});

// ─── Chat endpoint ─────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const {
    sessionId, stage, userMessage, history,
    psych, memory, totalTurns, insuranceMentionTurn,
    discoveryLevel, wrongCloseCount, latestSpecificPitch,
    sessionState,                      // 'normal' | 'exit_intent_expressed' | 'recovery_pending' | 'recovered' | 'terminated'
    exitIntentCount,
    revealedFacts,                     // array of strings
  } = req.body || {};

  if (!sessionId || typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const session = getSession(sessionId);
  const archetypeKey = session?.archetypeKey || 'default';
  const coverKey     = session?.coverKey || 'starter_protection';
  const userMsg = userMessage.slice(0, 2000);
  const trimmedHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000),
    }));

  // ── Pre-flight detections on SELLER message
  const severe       = detectSevere(userMsg);
  const confirmingQs = detectConfirmingQ(userMsg);
  const privateRefs  = detectPrivate(userMsg);
  const insuranceNow = isInsuranceMention(userMsg);

  const pitchType       = classifySellerPitch(userMsg);       // cover-key | 'multiple' | 'generic' | null
  const probeDirection  = classifyProbeDirection(userMsg);    // cover-key | 'multiple' | 'neutral'
  const sellerClosing   = isSellerCloseAttempt(userMsg);

  const probeAligned   = probeDirection === coverKey;
  const probeAdjacent  = probeDirection !== 'neutral' && probeDirection !== 'multiple' && probeDirection !== coverKey;
  const pitchAligned   = pitchType === coverKey;
  const pitchMisaligned = pitchType && pitchType !== 'generic' && pitchType !== 'multiple' && pitchType !== coverKey;

  // ── v4 state-machine: is this seller message a RECOVERY ATTEMPT?
  const inExitIntentState = sessionState === SESSION_STATES.EXIT_INTENT_EXPRESSED;
  const recoveryAttempted = inExitIntentState;
  const recoveryEval = recoveryAttempted ? evaluateRecoveryAttempt(userMsg) : { valid: false };

  // ── Latest specific pitch tracking (for wrong-close detection)
  let effectivePitchType = latestSpecificPitch || null;
  if (pitchType && pitchType !== 'generic' && pitchType !== 'multiple') {
    effectivePitchType = pitchType;
  } else if (pitchType === 'multiple' && !effectivePitchType) {
    effectivePitchType = 'multiple';
  }

  const wrongPitch = pitchType && pitchType !== 'generic' && pitchType !== 'multiple' && pitchType !== coverKey;
  const wrongCloseAttempt = sellerClosing
    && effectivePitchType
    && effectivePitchType !== 'generic'
    && effectivePitchType !== 'multiple'
    && effectivePitchType !== coverKey;

  const discoveryIncrement = probeAligned ? 1 : 0;

  let latestSpecificPitchAligned = null;
  if (effectivePitchType && effectivePitchType !== 'multiple' && effectivePitchType !== 'generic') {
    latestSpecificPitchAligned = effectivePitchType === coverKey;
  }

  // ── Insurance walk-away dice roll
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

  // ── WALK-AWAY overlay-only short-circuit
  if (walkAway && walkPresentation === 'overlay_only') {
    logTurn(sessionId, {
      turn: (totalTurns || 0) + 1, stage,
      userMessage: userMsg,
      severeBreach: severe.map(s => s.label),
      privateRefs:  privateRefs.map(p => p.label),
      confirmingQ:  confirmingQs.map(c => c.label),
      insuranceMention: true, pitchType, probeDirection,
      walked: true, walkPresentation,
      reply: null,
      thought: '[Ivan walked silently — insurance mentioned too early]',
      ignored: true,
    });
    return res.json({
      reply: null, ignored: true, walked: true, walkPresentation: 'overlay_only',
      severeBreach: severe[0] || null, privateRefs, confirmingQ: confirmingQs,
      insuranceMention: true, legitimacy: null, optOut: false,
      pitchType, probeDirection, effectivePitchType, sellerClosing,
      wrongPitch: false, wrongCloseAttempt: false,
      probeAligned: false, probeAdjacent: false, pitchAligned: false,
      latestSpecificPitchAligned: null, discoveryIncrement: 0,
      sessionState: SESSION_STATES.TERMINATED,
      exitIntent: false, recoveryEval: null,
    });
  }

  // ── Breach-judge fallback trigger
  const adjacentRe = /\b(your|you).{0,30}\b(weekend|morning|run|gym|trail|friend|ski|knee|ankle|injur|niseko|hokkaido|tai\s*tam|quarry|MPF|tax|salary|saving|spend|coverage|insurer)\b/i;
  const shouldJudge = severe.length === 0 && privateRefs.length === 0
    && userMsg.length > 60 && adjacentRe.test(userMsg);

  // ── Quality + disclosure permission + turn instruction
  const quality = preScoreMessage(userMsg, stage, insuranceNow, coverKey);
  const disclosurePermission = computeDisclosurePermission({
    stage, quality, probeAligned, probeAdjacent,
  });
  const turnInstruction = getTurnInstruction({
    stage, quality, psych: psych || {},
    severeBreach: severe[0] || null,
    walkAway, totalTurns: totalTurns || 0,
    wrongPitch, wrongCloseAttempt,
    sessionState,
  });

  const system = buildSystemPrompt({
    archetypeKey, coverKey, stage,
    psych: psych || {}, memory: memory || {},
    turnInstruction,
    totalTurns: totalTurns || 0,
    insuranceMentioned: !!insuranceMentionTurn || insuranceNow,
    insuranceMentionTurn: insuranceMentionTurn || (insuranceNow ? (totalTurns || 0) + 1 : null),
    discoveryLevel: discoveryLevel || 0,
    disclosurePermission,
    revealedFacts: revealedFacts || [],
    sessionState,
  });

  const messages = [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user',   content: userMsg },
  ];

  // ── Parallel: persona call + optional breach judge
  const callPersona = () => fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL, stream: false, messages,
      max_tokens: 400, temperature: 0.85,
      response_format: { type: 'json_object' },
    }),
  });

  const callJudgeP = shouldJudge
    ? judgeBreach({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, sellerMessage: userMsg })
    : Promise.resolve(null);

  let personaResp, judgeResp;
  try {
    [personaResp, judgeResp] = await Promise.all([callPersona(), callJudgeP]);
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

  let personaData = await personaResp.json();
  let rawContent = personaData.choices?.[0]?.message?.content || '';
  let parsed = parseJsonLoose(rawContent);

  // ── Grounding validator pass 1
  let validatorRan = false, validatorOk = true, validatorIssue = null;
  let regenAttempted = false;
  const runValidation = async (candidateReply) => {
    const rc = regexGroundingCheck(candidateReply, trimmedHistory, userMsg);
    if (!rc.ok) return { ok: false, issue: rc.issues[0], layer: 'regex' };
    if (!shouldValidateLLM(candidateReply, 0)) return { ok: true };
    const llm = await llmGroundingCheck({
      apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL,
      conversationHistory: trimmedHistory, latestSellerMsg: userMsg,
      ivanReply: candidateReply,
    });
    if (llm.ok === false) return { ok: false, issue: llm.issue, layer: 'llm' };
    return { ok: true };
  };

  if (parsed?.reply && typeof parsed.reply === 'string') {
    validatorRan = true;
    const v = await runValidation(parsed.reply);
    if (!v.ok) {
      validatorOk = false;
      validatorIssue = v.issue;

      // ── Pass 2: ONE regeneration with tightening instruction
      regenAttempted = true;
      const tightenedSystem = system + `

<grounding_repair>
A previous draft of your reply was flagged for grounding violation: "${v.issue.description}"
${v.issue.phrase ? `Problematic fragment: "${v.issue.phrase}"` : ''}

DO NOT acknowledge, thank for, or reference anything the seller has NOT literally said. If the seller did not offer a free trial, do not mention one. If they did not give a price, do not quote one. Rewrite your reply to be strictly grounded in what was said.
</grounding_repair>`;
      try {
        const r2 = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL, stream: false,
            messages: [
              { role: 'system', content: tightenedSystem },
              ...trimmedHistory,
              { role: 'user', content: userMsg },
            ],
            max_tokens: 400, temperature: 0.4,
            response_format: { type: 'json_object' },
          }),
        });
        if (r2.ok) {
          const d2 = await r2.json();
          const parsed2 = parseJsonLoose(d2.choices?.[0]?.message?.content || '');
          if (parsed2?.reply) {
            const v2 = await runValidation(parsed2.reply);
            if (v2.ok) {
              parsed = parsed2;
              validatorOk = true;
              validatorIssue = null;
            } else {
              // Regen also failed — fall back to a safe minimal reply
              parsed = {
                thought: '[grounding repair failed — fallback reply used]',
                reply: 'hmm, can you clarify what you mean',
                ignoring_reason: '',
                disclosed_fact: '',
              };
              validatorIssue = v2.issue;
            }
          }
        }
      } catch (e) {
        console.error('Regen call failed:', e.message);
      }
    }
  }

  if (!parsed) {
    parsed = {
      thought: '[parse failure — model did not return valid JSON]',
      reply: rawContent.slice(0, 200),
      ignoring_reason: '',
      disclosed_fact: '',
    };
  }

  // ── Post-process reply (strip sentinels)
  let reply = parsed.reply;
  let ignored = false;
  let ignoringReason = parsed.ignoring_reason || '';
  let disclosedFact = (parsed.disclosed_fact && typeof parsed.disclosed_fact === 'string') ? parsed.disclosed_fact.trim() : '';

  if (reply === null || reply === undefined) { ignored = true; reply = null; }
  else if (typeof reply !== 'string') reply = String(reply);

  if (typeof reply === 'string') {
    const stripped = reply.trim();
    const sentinelRe = /^\s*\[?\s*(no\s*reply|no\s*response|ignored|ignoring|silence|no\s*comment|null|n\/a|nothing|message\s*ignored|skip|skipped|empty)\s*\]?\s*\.?\s*$/i;
    const punctOnly  = /^[\s.!?,;:\-_*…"'()[\]{}]{0,8}$/;
    if (!stripped || sentinelRe.test(stripped) || punctOnly.test(stripped)) {
      ignored = true; reply = null;
      if (!ignoringReason) ignoringReason = 'model returned empty/sentinel placeholder';
    }
  }

  // ── Judge breach override
  let judgeBreachDetected = null;
  if (judgeResp?.breach === true) {
    judgeBreachDetected = {
      label: judgeResp.fact_referenced || 'private fact (judge-detected)',
      explanation: judgeResp.explanation || '',
    };
  }

  // ── Detect signals in Ivan's reply
  const legitimacy = reply ? detectLegitimacy(reply) : null;
  const optOut     = reply ? isOptOut(reply) : false;
  const ivanClose  = reply ? isUserClose(reply) : false;
  const ivanExitIntent = reply ? isExitIntent(reply) : false;
  // "Re-engaged" heuristic: asked a question, or positive keyword, and NOT exit intent
  const REENGAGE_RE = /\?|(fair|ok|alright|hmm|actually|tell me|what is|how does|so|go on|sure)/i;
  const ivanReengaged = !!reply && !ivanExitIntent && REENGAGE_RE.test(reply);

  // ── State-machine transition
  const smResult = smTransition(sessionState || SESSION_STATES.NORMAL, {
    ivanExitIntent, ivanReengaged,
    recoveryAttempted, recoveryValid: recoveryEval?.valid,
    exitIntentCount: exitIntentCount || 0,
  });

  // ── Score
  const score = scoreTurn({
    userMsg, ivanReply: reply, stage, quality,
    signals: {
      severeBreach: severe[0] || judgeBreachDetected,
      privateRefs, confirmingQ: confirmingQs,
    },
    alignment: {
      probeDirection, probeAligned, probeAdjacent,
      pitchType, pitchAligned, pitchMisaligned,
      coverKey,
      wrongClose: wrongCloseAttempt,
    },
  });

  // ── Audit log
  logTurn(sessionId, {
    turn: (totalTurns || 0) + 1, stage,
    userMessage: userMsg,
    quality, score,
    severeBreach: severe.map(s => s.label),
    privateRefs: privateRefs.map(p => p.label),
    confirmingQ: confirmingQs.map(c => c.label),
    judgeBreach: judgeBreachDetected,
    insuranceMention: insuranceNow,
    pitchType, probeDirection, sellerClosing,
    wrongPitch, wrongCloseAttempt,
    walked: walkAway, walkPresentation,
    thought: parsed.thought,
    reply, ignored, ignoringReason,
    disclosedFact, disclosurePermission,
    legitimacy: legitimacy?.type || null,
    optOut, ivanClose, ivanExitIntent,
    sessionStateIn: sessionState || SESSION_STATES.NORMAL,
    sessionStateOut: smResult.nextState,
    recoveryEval,
    validator: { ran: validatorRan, ok: validatorOk, issue: validatorIssue, regenAttempted },
    psychSnapshot: psych || {},
  });

  res.json({
    reply: ignored ? null : reply,
    ignored, walked: walkAway, walkPresentation,
    severeBreach: severe[0] || judgeBreachDetected || null,
    privateRefs, confirmingQ: confirmingQs,
    insuranceMention: insuranceNow,
    legitimacy, optOut, ivanClose, ivanExitIntent,
    pitchType, probeDirection, effectivePitchType,
    sellerClosing,
    probeAligned, probeAdjacent,
    pitchAligned, pitchMisaligned,
    wrongPitch, wrongCloseAttempt,
    latestSpecificPitchAligned,
    discoveryIncrement,
    disclosurePermission,
    disclosedFact,
    sessionState: smResult.nextState,
    terminate: !!smResult.terminate,
    terminalOutcome: smResult.terminalOutcome || null,
    terminalReason: smResult.terminalReason || null,
    recoveryEval: recoveryAttempted ? recoveryEval : null,
    validator: { ran: validatorRan, ok: validatorOk, regenAttempted },
    score,
    quality,
  });
});

// ─── Session end ──────────────────────────────────────────
app.post('/api/session/end', (req, res) => {
  const { sessionId, outcome, finalState } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'Invalid sessionId.' });
  endSession(sessionId, outcome, finalState);
  res.json({ ok: true });
});

// ─── Debrief ──────────────────────────────────────────────
app.post('/api/session/debrief', async (req, res) => {
  const { sessionId, transcript, stageScores, outcome } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'Invalid sessionId.' });
  const session = getSession(sessionId);
  const archetypeKey = session?.archetypeKey || 'default';
  const coverKey     = session?.coverKey || 'starter_protection';
  const arch = ARCHETYPES[archetypeKey];
  const cover = COVERS[coverKey];

  const [transitionResult, momentsResult, exemplarResult, needResult] = await Promise.all([
    judgeTransition({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    judgeKeyMoments({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    generateExemplar({
      apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL,
      transcript: transcript || [],
      archetypeName: arch.name,
      coverShortName: cover.shortName,
      coverOneLiner: cover.oneLiner,
    }),
    judgeNeedDiscovery({
      apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL,
      transcript: transcript || [],
      coverKey, allCovers: COVERS,
    }),
  ]);

  const debrief = {
    archetype: { name: arch.name, description: arch.description },
    cover: {
      key: cover.key,
      shortName: cover.shortName,
      oneLiner: cover.oneLiner,
      category: cover.category,
      need: cover.need,
      sellingPoints: cover.sellingPoints,
      whySuperiorVsAlternatives: cover.whySuperiorVsAlternatives,
      tradeOffs: cover.tradeOffs,
      optionalBundles: cover.optionalBundles,
    },
    stageScores: stageScores || {},
    transition: transitionResult,
    keyMoments: momentsResult,
    exemplarBridge: exemplarResult,
    needDiscovery: needResult,
    outcome: outcome || session?.outcome || 'unknown',
  };
  attachDebrief(sessionId, debrief);
  res.json(debrief);
});

// ─── Facilitator log (token-gated) ─────────────────────────
app.get('/api/admin/log.json', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin export disabled.' });
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized.' });
  res.json(exportAll());
});

app.get('/api/admin/log', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).send('Admin export disabled.');
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).send('Unauthorized.');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderAllSessionsPage(exportAll()));
});

// Per-session HTML (trainee download)
app.get('/api/session/report.html', (req, res) => {
  const { sessionId } = req.query || {};
  if (!sessionId) return res.status(400).send('Missing sessionId.');
  const s = getSession(sessionId);
  if (!s) return res.status(404).send('Session not found.');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderSessionPage(s, { forDownload: true }));
});

// Facilitator cheatsheet (token-gated HTML)
app.get('/facilitator', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).send('Cheatsheet disabled (ADMIN_TOKEN not set).');
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).send('Unauthorized.');
  const p = join(__dirname, 'docs', 'FACILITATOR_CHEATSHEET.md');
  if (!existsSync(p)) return res.status(404).send('Cheatsheet not found.');
  const md = readFileSync(p, 'utf-8');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderCheatsheetHtml(md));
});

// Very small markdown → HTML for the cheatsheet (server-side, no deps).
function renderCheatsheetHtml(md) {
  const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const lines = md.split('\n');
  const out = [];
  let inList = false, inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) { if (inCode) out.push('</pre>'); else out.push('<pre>'); inCode = !inCode; continue; }
    if (inCode) { out.push(esc(line)); continue; }
    if (/^#\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h1>' + esc(line.slice(2)) + '</h1>'); continue; }
    if (/^##\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h2>' + esc(line.slice(3)) + '</h2>'); continue; }
    if (/^###\s/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<h3>' + esc(line.slice(4)) + '</h3>'); continue; }
    if (/^\s*[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + esc(line.replace(/^\s*[-*]\s/, '')) + '</li>');
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.trim() === '') out.push('<br>');
    else out.push('<p>' + esc(line) + '</p>');
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</pre>');
  return `<!doctype html><meta charset="utf-8"><title>Facilitator — InsureSim v4</title>
<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#222;line-height:1.55}
h1{font-size:28px;border-bottom:1px solid #ddd;padding-bottom:8px}h2{font-size:20px;margin-top:32px}h3{font-size:16px;color:#555}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;font-size:13px}li{margin:4px 0}p{margin:8px 0}</style>
${out.join('\n')}`;
}

// ─── SPA fallback ─────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`InsureSim v4 running on port ${PORT}`);
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  console.log(`Admin export: ${ADMIN_TOKEN ? 'enabled' : 'disabled'}`);
  console.log(`Covers loaded: ${COVER_KEYS.join(', ')}`);
});

// ─── Helpers ─────────────────────────────────────────────
function parseJsonLoose(raw) {
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
}
