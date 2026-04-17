// server.js
// InsureSim v2 — server-side prompt assembly, JSON output, LLM judges, audit log.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';

import { ARCHETYPES, pickArchetype } from './src/personas.js';
import { buildSystemPrompt, getTurnInstruction, preScoreMessage } from './src/prompts.js';
import {
  detectSevere, detectConfirmingQ, detectPrivate, detectLegitimacy,
  isInsuranceMention, isOptOut, insuranceWalkProbability
} from './src/breaches.js';
import { judgeBreach, judgeTransition, judgeKeyMoments, generateExemplar } from './src/judges.js';
import { createSession, logTurn, endSession, getSession, exportAll } from './src/audit.js';
import { scoreTurn } from './src/scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT               = process.env.PORT || 3000;
const DEEPSEEK_API_KEY   = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL     = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const ADMIN_TOKEN        = process.env.ADMIN_TOKEN || null;
const DEEPSEEK_URL       = 'https://api.deepseek.com/v1/chat/completions';

if (!DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set in environment.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(__dirname, 'public')));
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

// ─── Health / warmup ──────────────────────────────────────────────
app.get('/api/warmup', (_req, res) => res.json({ ok: true, model: DEEPSEEK_MODEL }));

// ─── Session start: assigns archetype, returns initial psych state ──
app.post('/api/session/start', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'Invalid sessionId.' });
  }
  const archetypeKey = pickArchetype();
  createSession(sessionId, archetypeKey);
  const arch = ARCHETYPES[archetypeKey];
  // Archetype name + description withheld until debrief.
  res.json({ ok: true, initialPsych: arch.initialPsych });
});

// ─── Chat: server assembles prompt, calls model, returns reply ────
app.post('/api/chat', async (req, res) => {
  const {
    sessionId, stage, userMessage, history,
    psych, memory, totalTurns, insuranceMentionTurn
  } = req.body || {};

  if (!sessionId || typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const session = getSession(sessionId);
  const archetypeKey = session?.archetypeKey || 'default';
  const userMsg = userMessage.slice(0, 2000);
  const trimmedHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000)
    }));

  // ─── Pre-flight detection ─────────────────────────────────────
  const severe       = detectSevere(userMsg);
  const confirmingQs = detectConfirmingQ(userMsg);
  const privateRefs  = detectPrivate(userMsg);
  const insuranceNow = isInsuranceMention(userMsg);

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

  // ─── If walk-away with overlay-only, skip the API entirely ────
  if (walkAway && walkPresentation === 'overlay_only') {
    logTurn(sessionId, {
      turn: (totalTurns || 0) + 1,
      stage,
      userMessage: userMsg,
      severeBreach: severe.map(s => s.label),
      privateRefs: privateRefs.map(p => p.label),
      confirmingQ: confirmingQs.map(c => c.label),
      insuranceMention: true,
      walked: true,
      walkPresentation,
      reply: null,
      thought: '[Ivan walked silently — insurance mentioned too early]',
      ignored: true
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
      optOut: false
    });
  }

  // ─── LLM judge for borderline cases (parallel with persona) ───
  // Only fires when regex caught nothing but message is long + private-adjacent
  const adjacentRe = /\b(your|you).{0,30}\b(weekend|morning|run|gym|trail|friend|ski|knee|ankle|injur|niseko|hokkaido|tai\s*tam|quarry|MPF|tax|salary|saving|spend|coverage|insurer)\b/i;
  const shouldJudge = severe.length === 0
    && privateRefs.length === 0
    && userMsg.length > 60
    && adjacentRe.test(userMsg);

  // ─── Quality + turn instruction ───────────────────────────────
  const quality = preScoreMessage(userMsg, stage, insuranceNow);
  const turnInstruction = getTurnInstruction({
    stage,
    quality,
    psych: psych || {},
    severeBreach: severe[0] || null,
    walkAway,
    totalTurns: totalTurns || 0
  });

  const system = buildSystemPrompt({
    archetypeKey,
    stage,
    psych: psych || {},
    memory: memory || {},
    turnInstruction,
    totalTurns: totalTurns || 0,
    insuranceMentioned: !!insuranceMentionTurn || insuranceNow,
    insuranceMentionTurn: insuranceMentionTurn || (insuranceNow ? (totalTurns || 0) + 1 : null)
  });

  const messages = [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user', content: userMsg }
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
      response_format: { type: 'json_object' }
    })
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
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
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
      explanation: judgeResp.explanation || ''
    };
  }

  // ─── Detect signals in Ivan's reply ───────────────────────────
  const legitimacy = reply ? detectLegitimacy(reply) : null;
  const optOut     = reply ? isOptOut(reply) : false;

  // ─── Score this turn ──────────────────────────────────────────
  const score = scoreTurn({
    userMsg,
    ivanReply: reply,
    stage,
    quality,
    signals: {
      severeBreach: severe[0] || judgeBreachDetected,
      privateRefs,
      confirmingQ: confirmingQs
    }
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
    walked: walkAway,
    walkPresentation,
    thought: parsed.thought,
    reply,
    ignored,
    ignoringReason,
    legitimacy: legitimacy?.type || null,
    optOut,
    psychSnapshot: psych || {}
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
    score
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
  const archetypeKey = session?.archetypeKey || 'default';
  const arch = ARCHETYPES[archetypeKey];

  const [transitionResult, momentsResult, exemplarResult] = await Promise.all([
    judgeTransition({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    judgeKeyMoments({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [] }),
    generateExemplar({ apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, transcript: transcript || [], archetypeName: arch.name })
  ]);

  res.json({
    archetype: { name: arch.name, description: arch.description },
    stageScores: stageScores || {},
    transition: transitionResult,
    keyMoments: momentsResult,
    exemplarBridge: exemplarResult,
    outcome: outcome || session?.outcome || 'unknown'
  });
});

// ─── Facilitator log export (token-gated) ─────────────────────────
app.get('/api/admin/log', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin export disabled (no ADMIN_TOKEN set).' });
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized.' });
  res.json(exportAll());
});

// ─── SPA fallback (must be LAST) ──────────────────────────────────
app.get('/', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`InsureSim v2 running on port ${PORT}`);
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  console.log(`Admin export: ${ADMIN_TOKEN ? 'enabled' : 'disabled'}`);
});
