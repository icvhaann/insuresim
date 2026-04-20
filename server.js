// server.js — InsureSim v5
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
import { regexGroundingCheck, llmGroundingCheck, shouldValidateLLM, antiRepetitionCheck, wildClaimCheck } from './src/validator.js';
import {
  SESSION_STATES, transition as smTransition,
  evaluateRecoveryAttempt, canAdvanceStage,
} from './src/stateMachine.js';
import { renderSessionPage, renderAllSessionsPage } from './src/logExport.js';
import { renderFactSheetPage, renderAllFactSheetsPage } from './src/factsheet.js';

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

  // ── Grounding validator pass 1 (v5: regex + anti-repetition + wild-claim + LLM)
  let validatorRan = false, validatorOk = true, validatorIssue = null;
  let regenAttempted = false;
  const runValidation = async (candidateReply) => {
    // Layer A: regex grounding (free-offer / price / link / plan-name hallucination)
    const rc = regexGroundingCheck(candidateReply, trimmedHistory, userMsg);
    if (!rc.ok) return { ok: false, issue: rc.issues[0], layer: 'regex_grounding' };

    // Layer B (v5): anti-repetition — Ivan can't repeat himself verbatim or nearly so
    const ar = antiRepetitionCheck(candidateReply, trimmedHistory);
    if (!ar.ok) return { ok: false, issue: ar.issue, layer: 'anti_repetition' };

    // Layer C (v5): wild-claim — Ivan can't invent competitors, percentages, absolute claims
    const wc = wildClaimCheck(candidateReply, trimmedHistory, userMsg);
    if (!wc.ok) return { ok: false, issue: wc.issues[0], layer: 'wild_claim' };

    // Layer D: LLM validator (only when signal warrants it)
    if (!shouldValidateLLM(candidateReply, 0)) return { ok: true };
    const llm = await llmGroundingCheck({
      apiKey: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL,
      conversationHistory: trimmedHistory, latestSellerMsg: userMsg,
      ivanReply: candidateReply,
    });
    if (llm.ok === false) return { ok: false, issue: llm.issue, layer: 'llm_grounding' };
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

// ─── Facilitator cheatsheet (token-gated HTML, v5: proper 401/503 pages) ─
app.get('/facilitator', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res
      .status(503)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(renderGatePage({
        title: 'Facilitator cheatsheet disabled',
        body: `<p>The facilitator cheatsheet is currently disabled on this server.</p>
<p>To enable it, set the <code>ADMIN_TOKEN</code> environment variable in your Railway (or local) configuration, then restart the server. Once set, visit this URL with the token as a query parameter:</p>
<pre>/facilitator?token=YOUR_ADMIN_TOKEN</pre>`,
      }));
  }
  if (req.query.token !== ADMIN_TOKEN) {
    return res
      .status(401)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(renderGatePage({
        title: 'Unauthorized',
        body: `<p>This page is restricted. You need to visit it with your <code>ADMIN_TOKEN</code> query parameter:</p>
<pre>/facilitator?token=YOUR_ADMIN_TOKEN</pre>
<p>Ask the workshop administrator for the token. The same token also unlocks <code>/api/admin/log</code> and <code>/facilitator/factsheets</code>.</p>`,
      }));
  }
  const p = join(__dirname, 'docs', 'FACILITATOR_CHEATSHEET.md');
  if (!existsSync(p)) {
    return res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(renderGatePage({
      title: 'Cheatsheet source missing',
      body: `<p>The cheatsheet markdown source (<code>docs/FACILITATOR_CHEATSHEET.md</code>) is missing from this deployment.</p>`,
    }));
  }
  const md = readFileSync(p, 'utf-8');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderCheatsheetHtml(md, req.query.token));
});

// ─── Fact sheet routes (v5) ──────────────────────────────
// Public per-cover fact sheet — useful for sharing individual product briefs.
// Token gate intentionally NOT applied here: these are product fact sheets,
// not internal coaching docs.
app.get('/api/factsheet/:coverKey.html', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderFactSheetPage(req.params.coverKey));
});

// Combined pack is facilitator-scoped (bulk printable brief).
app.get('/facilitator/factsheets', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).set('Content-Type', 'text/html').send(renderGatePage({
    title: 'Fact sheet pack disabled',
    body: `<p>Set <code>ADMIN_TOKEN</code> to enable this page.</p>`,
  }));
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).set('Content-Type', 'text/html').send(renderGatePage({
    title: 'Unauthorized',
    body: `<p>Visit with <code>?token=YOUR_ADMIN_TOKEN</code>.</p>`,
  }));
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderAllFactSheetsPage());
});

// v5: nicer gate page (shared for 401/503 across facilitator routes).
function renderGatePage({ title, body }) {
  return `<!doctype html><meta charset="utf-8"><title>${title} — InsureSim</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#222;line-height:1.55}
h1{font-size:22px;margin-bottom:12px}pre{background:#f6f8fa;padding:10px 14px;border-radius:6px;font-size:13px;overflow:auto}
code{background:#f6f8fa;padding:2px 6px;border-radius:3px;font-size:13px}a{color:#2c5aa0}
.back{margin-top:24px;font-size:12px;color:#888}</style>
<h1>${title}</h1>${body}<div class="back"><a href="/">← Back to simulator</a></div>`;
}

// v5: improved markdown → HTML for the cheatsheet.
// Handles: headings, ordered + unordered lists, code blocks, tables (pipe
// syntax), horizontal rules, inline code / bold / italic / links. Plus a
// print button and a "Download printable HTML" link that serves the same
// content with print-only styling.
function renderCheatsheetHtml(md, token) {
  const escText = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Inline formatting (safe on already-escaped content).
  const renderInline = s => {
    let out = escText(s);
    // Code spans
    out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    // Bold **x**
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic _x_ (conservative — only when surrounded by spaces or line start)
    out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    // Links [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
    return out;
  };

  const lines = String(md || '').split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let inList = false;
  let listTag = 'ul';

  const closeList = () => { if (inList) { out.push(`</${listTag}>`); inList = false; } };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      closeList();
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else        { out.push('<pre><code>'); inCode = true; }
      i++;
      continue;
    }
    if (inCode) { out.push(escText(line)); i++; continue; }

    // Table: current line has pipes and next line is a separator
    if (/\|/.test(line) && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
      closeList();
      const header = line.split('|').map(s => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim().length > 0) {
        const cells = lines[i].split('|').map(s => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
        rows.push(cells);
        i++;
      }
      out.push('<table><thead><tr>' + header.map(h => `<th>${renderInline(h)}</th>`).join('') + '</tr></thead>');
      out.push('<tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const hMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hMatch) {
      closeList();
      const level = hMatch[1].length;
      out.push(`<h${level}>${renderInline(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      if (!inList || listTag !== 'ol') { closeList(); out.push('<ol>'); inList = true; listTag = 'ol'; }
      out.push(`<li>${renderInline(olMatch[1])}</li>`);
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ulMatch) {
      if (!inList || listTag !== 'ul') { closeList(); out.push('<ul>'); inList = true; listTag = 'ul'; }
      out.push(`<li>${renderInline(ulMatch[1])}</li>`);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    // Paragraph
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
    i++;
  }
  closeList();
  if (inCode) out.push('</code></pre>');

  const printableUrl = `/facilitator/printable?token=${encodeURIComponent(token || '')}`;
  const factsheetsUrl = `/facilitator/factsheets?token=${encodeURIComponent(token || '')}`;
  const logUrl = `/api/admin/log?token=${encodeURIComponent(token || '')}`;

  return `<!doctype html><meta charset="utf-8"><title>Facilitator — InsureSim v5</title>
<style>
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:840px;margin:20px auto;padding:20px;color:#222;line-height:1.6;background:#fafbfc}
.toolbar{position:sticky;top:0;background:#fff;border:1px solid #e3e6ea;border-radius:6px;padding:10px 14px;margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
.toolbar a,.toolbar button{background:#2c5aa0;color:#fff;text-decoration:none;padding:6px 12px;border-radius:4px;font-size:13px;border:none;cursor:pointer;font-family:inherit}
.toolbar a:hover,.toolbar button:hover{background:#244a8a}
.toolbar a.secondary{background:#fff;color:#2c5aa0;border:1px solid #2c5aa0}
h1{font-size:28px;border-bottom:2px solid #2c5aa0;padding-bottom:8px;margin-top:20px}
h2{font-size:20px;margin-top:32px;color:#111}
h3{font-size:15px;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-top:20px}
h4{font-size:14px;color:#666;margin-top:16px}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;font-size:13px;border:1px solid #e3e6ea}
code{background:#f6f8fa;padding:2px 6px;border-radius:3px;font-size:13px;font-family:'SF Mono',Menlo,monospace}
li{margin:4px 0}p{margin:10px 0}hr{border:none;border-top:1px solid #e3e6ea;margin:24px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th{background:#f0f2f5;text-align:left;padding:8px 10px;border-bottom:2px solid #d0d4da;font-weight:600}
td{padding:7px 10px;border-bottom:1px solid #eef0f2;vertical-align:top}
tr:nth-child(even) td{background:#fafbfc}
a{color:#2c5aa0}
@media print {
  .toolbar{display:none}
  body{background:#fff;max-width:100%;padding:0}
  h1{break-after:avoid}h2,h3{break-after:avoid}
  tr{break-inside:avoid}pre{break-inside:avoid}
}
</style>
<div class="toolbar">
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
  <a href="${printableUrl}" class="secondary">Open in printable layout</a>
  <a href="${factsheetsUrl}" class="secondary">5 cover fact sheets</a>
  <a href="${logUrl}" class="secondary">Session log</a>
</div>
${out.join('\n')}`;
}

// v5: printable variant — same markdown, minimal chrome, print dialog on load.
app.get('/facilitator/printable', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).set('Content-Type', 'text/html').send(renderGatePage({ title: 'Disabled', body: '<p>Set ADMIN_TOKEN.</p>' }));
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).set('Content-Type', 'text/html').send(renderGatePage({ title: 'Unauthorized', body: '<p>Token required.</p>' }));
  const p = join(__dirname, 'docs', 'FACILITATOR_CHEATSHEET.md');
  if (!existsSync(p)) return res.status(404).send('Cheatsheet source missing.');
  const md = readFileSync(p, 'utf-8');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderCheatsheetPrintable(md));
});

function renderCheatsheetPrintable(md) {
  // Reuse renderCheatsheetHtml by stripping the toolbar and auto-calling print.
  // Simplest approach: wrap in print-optimized doc.
  const escText = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Quick-and-simple — use same tokenizer as the HTML version but without the toolbar
  const inline = s => {
    let out = escText(s);
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return out;
  };
  const lines = String(md || '').split('\n');
  const out = [];
  let inCode = false, inList = false, listTag = 'ul';
  const closeList = () => { if (inList) { out.push(`</${listTag}>`); inList = false; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) { closeList(); out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; i++; continue; }
    if (inCode) { out.push(escText(line)); i++; continue; }
    if (/\|/.test(line) && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
      closeList();
      const header = line.split('|').map(s => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim().length > 0) {
        const cells = lines[i].split('|').map(s => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
        rows.push(cells); i++;
      }
      out.push('<table><thead><tr>' + header.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
    const hMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hMatch) { closeList(); out.push(`<h${hMatch[1].length}>${inline(hMatch[2])}</h${hMatch[1].length}>`); i++; continue; }
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ulMatch) { if (!inList || listTag !== 'ul') { closeList(); out.push('<ul>'); inList = true; listTag = 'ul'; } out.push(`<li>${inline(ulMatch[1])}</li>`); i++; continue; }
    if (line.trim() === '') { closeList(); i++; continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return `<!doctype html><meta charset="utf-8"><title>Facilitator cheatsheet — printable</title>
<style>body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:20mm auto;padding:0 20px;color:#000;line-height:1.5;font-size:12pt}
h1{font-size:20pt;border-bottom:2px solid #000;padding-bottom:6px}h2{font-size:15pt;margin-top:20pt}h3{font-size:12pt;text-transform:uppercase;letter-spacing:0.05em}
pre{background:#f4f4f4;padding:10px;font-family:'Courier New',monospace;font-size:10pt;border:1px solid #ccc}
code{background:#f4f4f4;padding:1px 4px;font-family:'Courier New',monospace;font-size:11pt}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:11pt}th{background:#ddd;padding:6px;border:1px solid #999;text-align:left}
td{padding:5px 6px;border:1px solid #ccc;vertical-align:top}
@media print{body{margin:0;padding:15mm}h1,h2,h3{break-after:avoid}tr{break-inside:avoid}}</style>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300))</script>
${out.join('\n')}`;
}

// ─── SPA fallback ─────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`InsureSim v5 running on port ${PORT}`);
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
