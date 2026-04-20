// app.js — InsureSim v5 client
//
// Changes vs v3:
//   • 5-cover state (probedDirections is an array of cover keys)
//   • Server is source of truth for sessionState; client mirrors it
//   • Exit-intent-driven hard termination (state machine terminal outcomes)
//   • Tracks revealedFacts (tags the server signals back in resp.disclosedFact)
//   • Terminal outcomes include new failed_exit_intent
//
// All prompt construction is server-side. This file manages UI state + HTTP.

'use strict';

// ── DOM refs ───────────────────────────────────────────────
const splash         = document.getElementById('splash');
const splashStart    = document.getElementById('splash-start');
const messagesEl     = document.getElementById('messages');
const inputEl        = document.getElementById('msg-input');
const sendBtn        = document.getElementById('send-btn');
const stageBadge     = document.getElementById('stage-badge');
const stageLblTop    = document.getElementById('stage-lbl-top');
const stageDisplay   = document.getElementById('stage-display');
const scoreAvgEl     = document.getElementById('score-avg');
const scoreCumEl     = document.getElementById('score-cumulative');
const scoreBarEl     = document.getElementById('score-bar');
const ignoreCountEl  = document.getElementById('ignore-counter');
const sidebar        = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebar-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const pip = id => document.getElementById(id);

// ── Config ─────────────────────────────────────────────────
const STAGE_MAX_TURNS    = { 1: 5,  2: 8,  3: 10 };
const STAGE_PASS_ACCUM   = { 1: 14, 2: 22, 3: 24 };
const STAGE_ADVANCE_TURN = { 1: 3,  2: 4,  3: 5  };
const STAGE_LABELS       = { 1: 'Hook', 2: 'Cultivate', 3: 'Convert' };
const MAX_IGNORES        = 3;

// Session states (mirror of src/stateMachine.js — kept in sync)
const SS = {
  NORMAL: 'normal',
  EXIT_INTENT_EXPRESSED: 'exit_intent_expressed',
  RECOVERY_PENDING: 'recovery_pending',
  RECOVERED: 'recovered',
  TERMINATED: 'terminated',
};

// ── State ──────────────────────────────────────────────────
let sessionId, currentStage, history, transcript;
let psych, memory;
let stageTurnCount, stageScoreAccum, perStageScores;
let totalTurns, consecutiveIgnores;
let sessionEnded, insuranceMentionTurn;
let discoveryLevel, latestSpecificPitch, wrongCloseCount;
let sessionState, exitIntentCount, revealedFacts;
// v5: cache the rendered HTML report client-side so downloads work even if the
// server evicted the session from its in-memory ring buffer (Image 2 bug).
let cachedReportHtml;
// v5: last seller message text, used for safe retry (resend-without-duplicate).
let lastSentText;
// v5: guard against double-submit while a turn is in flight.
let turnInFlight;

resetState();

function resetState() {
  sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  currentStage = 1;
  history = [];
  transcript = [];
  psych = { trust: 50, skepticism: 38, creepiness: 0, engagement: 15, scamSuspicion: 0 };
  memory = {
    sports: [], injuries: false, jobConfirmed: false,
    priceAsked: false, coverageAsked: [],
    freebieOffered: false, legitimacyChallenged: false,
    probedDirections: [], wrongPitchedOnce: false,
  };
  stageTurnCount = 0;
  stageScoreAccum = 0;
  perStageScores = [];
  totalTurns = 0;
  consecutiveIgnores = 0;
  sessionEnded = false;
  insuranceMentionTurn = null;
  discoveryLevel = 0;
  latestSpecificPitch = null;
  wrongCloseCount = 0;
  sessionState = SS.NORMAL;
  exitIntentCount = 0;
  revealedFacts = [];
  cachedReportHtml = null;
  lastSentText = null;
  turnInFlight = false;
}

// ── Sidebar toggle ─────────────────────────────────────────
sidebarToggle.addEventListener('click', () => {
  if (window.innerWidth <= 640) {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  } else {
    sidebar.classList.toggle('collapsed');
  }
});
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
});

// ── Splash ─────────────────────────────────────────────────
splashStart.addEventListener('click', startSession);

async function startSession() {
  splash.style.opacity = '0';
  setTimeout(() => { splash.style.display = 'none'; }, 400);
  try {
    const r = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await r.json();
    if (data?.initialPsych) psych = { ...psych, ...data.initialPsych };
  } catch (e) { console.error('Session start failed:', e); }
  fetch('/api/warmup').catch(() => {});
  pip('pip1').classList.add('active');
  inputEl.focus();
}

// ── Send ────────────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  if (sessionEnded) return;
  if (turnInFlight) return;  // v5: guard double-submit
  const text = inputEl.value.trim();
  if (!text) return;
  if (text.length > 2000) { showSystemMsg('Message too long (max 2000 chars).'); return; }

  inputEl.value = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;
  turnInFlight = true;
  lastSentText = text;

  addMessageBubble('user', text);
  history.push({ role: 'user', content: text });
  transcript.push({ role: 'seller', content: text });

  const typing = addTypingIndicator();

  // v5: structured error categorization.
  // Only SHOW_RETRY toast on true server/network failure.
  // For other error classes show a specific, non-alarming message.
  let resp;
  let errorKind = null;
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        stage: currentStage,
        userMessage: text,
        history, psych, memory,
        totalTurns, insuranceMentionTurn,
        discoveryLevel, latestSpecificPitch, wrongCloseCount,
        sessionState, exitIntentCount,
        revealedFacts,
      })
    });

    if (r.status === 429) {
      errorKind = 'rate_limit';
    } else if (r.status >= 500) {
      errorKind = 'server_error';
    } else if (r.status >= 400) {
      errorKind = 'client_error';
    } else {
      // 2xx — parse JSON carefully
      try {
        resp = await r.json();
      } catch (parseErr) {
        console.error('Response JSON parse failed:', parseErr);
        errorKind = 'parse_error';
      }
    }
  } catch (netErr) {
    console.error('Network error:', netErr);
    errorKind = 'network_error';
  }

  typing.remove();

  if (errorKind) {
    turnInFlight = false;
    // Rewind the client-side turn: remove the user's bubble so retry is clean
    // and don't log it twice.
    try {
      const msgs = messagesEl.querySelectorAll('.msg.user');
      if (msgs.length > 0) msgs[msgs.length - 1].remove();
    } catch (_) {}
    history.pop();
    transcript.pop();

    // Restore input so the user can retry
    inputEl.value = text;

    if (errorKind === 'rate_limit') {
      showSystemMsg('Too many messages too fast — wait a few seconds and press Send again.');
    } else if (errorKind === 'server_error' || errorKind === 'network_error') {
      showSystemMsg('Something went wrong on the server. Try again.');
    } else if (errorKind === 'parse_error') {
      showSystemMsg('Received an unexpected response. Press Send again to retry.');
    } else if (errorKind === 'client_error') {
      showSystemMsg('Your session may have expired. Please refresh and start again.');
    }
    reEnableInput();
    return;
  }

  // v5: defensive — guard entire downstream handling.
  // If ANY exception occurs below, we treat it as a recoverable client-side
  // error, log to console, and let the user retry without terminating the
  // session or showing the scary "server error" toast.
  try {
    await handleChatResponse(text, resp);
  } catch (handlerErr) {
    console.error('Chat response handler threw:', handlerErr);
    showSystemMsg('Hmm, something glitched on my end. Try sending that again.');
    // Reverse the turn so retry is clean
    try {
      const msgs = messagesEl.querySelectorAll('.msg.user');
      if (msgs.length > 0) msgs[msgs.length - 1].remove();
    } catch (_) {}
    history.pop();
    transcript.pop();
    inputEl.value = text;
    reEnableInput();
  } finally {
    turnInFlight = false;
  }
}

// ── All response handling lives here, isolated from the network layer.
// Any exception thrown inside is caught above and the user sees a recoverable
// retry prompt (not the generic "Something went wrong" toast).
async function handleChatResponse(text, resp) {
  if (!resp || typeof resp !== 'object') {
    throw new Error('Empty response body');
  }

  totalTurns += 1;
  stageTurnCount += 1;

  updateMemoryFromUser(text);
  updateMemoryFromSignals(resp);
  if (resp.insuranceMention && !insuranceMentionTurn) insuranceMentionTurn = totalTurns;

  if (resp.effectivePitchType && resp.effectivePitchType !== 'multiple' && resp.effectivePitchType !== 'generic') {
    latestSpecificPitch = resp.effectivePitchType;
  }
  if (resp.discoveryIncrement) discoveryLevel = Math.min(5, discoveryLevel + resp.discoveryIncrement);
  if (resp.wrongCloseAttempt) wrongCloseCount += 1;

  // v4: track revealed facts (server tags them)
  if (resp.disclosedFact) revealedFacts.push(resp.disclosedFact);

  // v4: mirror session state from server
  if (resp.sessionState) sessionState = resp.sessionState;
  if (resp.ivanExitIntent) exitIntentCount += 1;

  updatePsychFromSignals(resp);

  // ── v4: hard terminate if state machine says so ────────
  if (resp.terminate && resp.terminalOutcome) {
    if (resp.reply) {
      addMessageBubble('bot', resp.reply);
      history.push({ role: 'assistant', content: resp.reply });
      transcript.push({ role: 'ivan', content: resp.reply });
    }
    return endSessionWith(resp.terminalOutcome, resp.terminalReason || 'Session terminated.');
  }

  // ── Walk-away (insurance-too-early dice) ──────────────
  if (resp.walked) {
    if (resp.walkPresentation === 'cold_reply' && resp.reply) {
      addMessageBubble('bot', resp.reply);
      history.push({ role: 'assistant', content: resp.reply });
      transcript.push({ role: 'ivan', content: resp.reply });
      await sleep(900);
    }
    return endSessionWith('walked', 'Ivan walked away — insurance came up too early in the conversation.');
  }

  // ── Ignored ────────────────────────────────────────────
  if (resp.ignored || resp.reply === null) {
    consecutiveIgnores += 1;
    addReadIgnoredHint();
    updateIgnoreCounter();
    if (consecutiveIgnores >= MAX_IGNORES) {
      return endSessionWith('failed_ignored', `Ivan stopped responding after ${MAX_IGNORES} ignored messages.`);
    }
    addStageScore(resp.score ?? 2);
    updateScorePanel();
    reEnableInput();
    checkStageProgression();
    return;
  }

  // ── Normal reply ────────────────────────────────────────
  consecutiveIgnores = 0;
  updateIgnoreCounter();
  addMessageBubble('bot', resp.reply);
  history.push({ role: 'assistant', content: resp.reply });
  transcript.push({ role: 'ivan', content: resp.reply });

  addStageScore(resp.score ?? 5);
  updateScorePanel();

  // ── Outcome checks ──
  if (resp.optOut) return endSessionWith('failed_optout', 'Ivan asked to be removed from contact.');

  // Second wrong-close attempt is terminal
  if (wrongCloseCount >= 2) {
    return endSessionWith('failed_missold', "Ivan disengaged after you tried to close on the wrong product type twice.");
  }

  // Ivan's close signal
  const ivanReadyToClose = resp.ivanClose ||
    (resp.legitimacy?.type === 'human_handoff' && currentStage === 3 && psych.trust >= 55);
  if (ivanReadyToClose) {
    if (resp.latestSpecificPitchAligned === true) {
      return endSessionWith('success', 'Ivan asked for the link / agent — and the product you landed on matches his actual need.');
    }
    if (resp.latestSpecificPitchAligned === false) {
      return endSessionWith('failed_missold', "Ivan agreed — but the product you were pitching wasn't the one that matches his concern.");
    }
    return endSessionWith('failed_unfocused', "Ivan said yes — but you never pitched a specific product type, so it's unclear what he agreed to.");
  }

  // Visual indicator if exit intent was just expressed (give seller a visible cue that they have ONE recovery turn)
  if (sessionState === SS.EXIT_INTENT_EXPRESSED) {
    showSystemMsg('Ivan expressed exit intent. You have ONE recovery turn — acknowledge, don\'t push.');
  }

  reEnableInput();
  checkStageProgression();
}

// ── Memory updates ─────────────────────────────────────────
function updateMemoryFromUser(text) {
  const m = text.toLowerCase();
  if (/\b(sport|active|workout|fit|exercise|gym)\b/.test(m) && !memory.sports.includes('general fitness')) memory.sports.push('general fitness');
  if (/\b(basketball|hoops|nba)\b/.test(m) && !memory.sports.includes('basketball'))                       memory.sports.push('basketball');
  if (/\b(ski|snowboard)\b/.test(m) && !memory.sports.includes('skiing'))                                  memory.sports.push('skiing');
  if (/\b(run|jog|trail)\b/.test(m) && !memory.sports.includes('running'))                                 memory.sports.push('running');
  if (/\b(injur|sprain|hurt|knee|ankle|broken|broke)\b/.test(m))                                           memory.injuries = true;
  if (/\b(consultant|consulting|finance|tech|job|work|career|central)\b/.test(m))                          memory.jobConfirmed = true;
  if (/\b(price|cost|hkd|month|premium)\b/.test(m))                                                        memory.priceAsked = true;
  if (/\b(exclude|exclusion|claim|payout|compare)\b/.test(m))                                              memory.coverageAsked.push(m.slice(0, 50));
  if (/\b(free|complimentary|no\s*cost|no\s*charge|trial|on\s*us|waive)\b/.test(m))                        memory.freebieOffered = true;
}

function updateMemoryFromSignals(resp) {
  if (!resp) return;
  if (resp.probeDirection && resp.probeDirection !== 'neutral' && resp.probeDirection !== 'multiple') {
    if (!memory.probedDirections.includes(resp.probeDirection)) {
      memory.probedDirections.push(resp.probeDirection);
    }
  }
  if (resp.wrongPitch) memory.wrongPitchedOnce = true;
}

function updatePsychFromSignals(resp) {
  const q  = resp.quality || 'neutral';
  const sb = !!resp.severeBreach;
  const pr = resp.privateRefs?.length || 0;
  const cq = resp.confirmingQ?.length || 0;
  const inMention = resp.insuranceMention;

  if (q === 'good')    { psych.trust += 4; psych.engagement += 5; psych.skepticism -= 3; }
  if (q === 'neutral') { psych.engagement += 1; }
  if (q === 'bad')     { psych.trust -= 3; psych.engagement -= 4; psych.skepticism += 4; }

  if (sb) { psych.trust -= 35; psych.creepiness += 50; psych.skepticism += 25; }
  if (pr) { psych.creepiness += 10 * pr; psych.trust -= 4 * pr; }
  if (cq) { psych.creepiness += 8 * cq;  psych.skepticism += 4 * cq; }

  if (inMention && currentStage <= 2) { psych.skepticism += 8; psych.engagement -= 6; }

  if (memory.freebieOffered) psych.engagement = clamp(psych.engagement + 2, 0, 100);
  if (resp.legitimacy?.type) memory.legitimacyChallenged = true;
  if (q === 'good' && psych.creepiness > 30) psych.creepiness -= 3;

  psych.trust         = clamp(psych.trust, 0, 100);
  psych.skepticism    = clamp(psych.skepticism, 0, 100);
  psych.creepiness    = clamp(psych.creepiness, 0, 100);
  psych.engagement    = clamp(psych.engagement, 0, 100);
  psych.scamSuspicion = clamp(psych.scamSuspicion, 0, 100);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Score + stage progression ──────────────────────────────
function addStageScore(score) { stageScoreAccum += score; }

function updateScorePanel() {
  const avg = stageTurnCount > 0 ? (stageScoreAccum / stageTurnCount).toFixed(1) : '\u2014';
  const needed = STAGE_PASS_ACCUM[currentStage] || 24;
  scoreAvgEl.textContent = avg;
  scoreCumEl.textContent = `${stageScoreAccum} / ${needed}`;
  const pct = Math.min(100, Math.round((stageScoreAccum / needed) * 100));
  scoreBarEl.style.width = pct + '%';
  if (avg !== '\u2014') {
    const a = parseFloat(avg);
    if (a >= 7)      scoreBarEl.style.background = 'var(--accent2)';
    else if (a >= 5) scoreBarEl.style.background = 'var(--accent)';
    else             scoreBarEl.style.background = 'var(--warn)';
  }
  stageDisplay.textContent = `Stage ${currentStage} / 3`;
}

function checkStageProgression() {
  // v4: block advancement while state-machine is in non-normal state
  if (sessionState === SS.EXIT_INTENT_EXPRESSED || sessionState === SS.RECOVERY_PENDING) return;

  const minTurns = STAGE_ADVANCE_TURN[currentStage];
  const needed = STAGE_PASS_ACCUM[currentStage];
  const maxTurns = STAGE_MAX_TURNS[currentStage];

  if (stageTurnCount >= minTurns && stageScoreAccum >= needed) { advanceStage(); return; }
  if (stageTurnCount >= maxTurns) {
    if (stageScoreAccum >= needed * 0.7) advanceStage();
    else endSessionWith('failed_stage', `Stage ${currentStage} ended without enough engagement to advance.`);
  }
}

function advanceStage() {
  perStageScores.push({
    stage: currentStage,
    avg: parseFloat((stageScoreAccum / stageTurnCount).toFixed(1)),
    total: stageScoreAccum, turns: stageTurnCount
  });

  if (currentStage === 3) {
    return endSessionWith('failed_unfocused', "You reached the end of stage 3 without Ivan asking for the link or the agent. The conversation didn't close.");
  }

  pip(`pip${currentStage}`).classList.remove('active');
  pip(`pip${currentStage}`).classList.add('done');
  currentStage += 1;
  pip(`pip${currentStage}`).classList.add('active');

  stageTurnCount = 0;
  stageScoreAccum = 0;

  stageLblTop.textContent = `Stage ${currentStage} \u00b7 ${STAGE_LABELS[currentStage]}`;
  stageBadge.textContent  = `Stage ${currentStage} \u00b7 ${STAGE_LABELS[currentStage]}`;
  stageBadge.className    = `stage-badge s${currentStage}`;

  showSystemMsg(`Advanced to Stage ${currentStage}: ${STAGE_LABELS[currentStage]}`);
  updateScorePanel();
}

// ── End session + debrief ──────────────────────────────────
async function endSessionWith(outcome, summary) {
  if (sessionEnded) return;
  sessionEnded = true;
  inputEl.disabled = true;
  sendBtn.disabled = true;

  if (stageTurnCount > 0) {
    perStageScores.push({
      stage: currentStage,
      avg: parseFloat((stageScoreAccum / stageTurnCount).toFixed(1)),
      total: stageScoreAccum, turns: stageTurnCount
    });
  }

  try {
    await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId, outcome,
        finalState: { stage: currentStage, psych, memory, totalTurns, insuranceMentionTurn, revealedFacts },
      })
    });
  } catch (e) { console.warn('session/end failed (non-fatal):', e?.message || e); }

  showInterimEnd(outcome, summary);

  let debrief = null;
  try {
    const r = await fetch('/api/session/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, transcript, stageScores: perStageScores, outcome })
    });
    if (r.ok) debrief = await r.json();
  } catch (e) { console.warn('session/debrief failed (non-fatal):', e?.message || e); }

  // v5: prefetch and cache the HTML report BEFORE showing the debrief overlay.
  // This way the download button always works, even if the session gets evicted
  // from the server's in-memory ring buffer afterwards (Image 2 bug).
  try {
    const reportResp = await fetch(`/api/session/report.html?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (reportResp.ok) {
      cachedReportHtml = await reportResp.text();
    } else {
      console.warn('Prefetch report.html returned', reportResp.status, '— will build client-side fallback');
      cachedReportHtml = buildFallbackReportHtml(outcome, summary, debrief);
    }
  } catch (e) {
    console.warn('Report prefetch failed, using fallback:', e?.message || e);
    cachedReportHtml = buildFallbackReportHtml(outcome, summary, debrief);
  }

  // Defensive — debrief rendering is wrapped in its own try/catch (v5 error
  // boundary). If it fails, the chat stays usable.
  try {
    showDebriefOverlay(outcome, summary, debrief);
  } catch (e) {
    console.error('Debrief rendering failed:', e);
    showSystemMsg('The session ended, but the summary panel failed to render. You can still download the report.');
    // Still show a minimal action row with just a download button
    try { renderMinimalDebriefActions(); } catch (_) {}
  }
}

// v5: client-side fallback if the server report endpoint is unavailable.
// Produces a minimal but usable HTML report from local state only.
function buildFallbackReportHtml(outcome, summary, debrief) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const turns = (transcript || []).map((t, i) => `
    <div style="border-bottom:1px solid #eee;padding:10px 0;">
      <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Turn ${i + 1} — ${t.role === 'seller' ? 'Seller' : 'Ivan'}</div>
      <div>${esc(t.content || '')}</div>
    </div>`).join('');
  const cover = debrief?.cover ? `
    <h2>True cover fit</h2>
    <p><strong>${esc(debrief.cover.shortName)}</strong> — ${esc(debrief.cover.oneLiner || '')}</p>
  ` : '';
  const stageRows = (perStageScores || []).map(s =>
    `<tr><td>Stage ${s.stage}</td><td>avg ${Number(s.avg || 0).toFixed(1)}</td><td>${s.turns} turns</td></tr>`
  ).join('');
  return `<!doctype html><meta charset="utf-8"><title>InsureSim session report</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#222;line-height:1.5}
h1{font-size:24px}h2{font-size:18px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{border-collapse:collapse;width:100%}td{padding:4px 10px;border-bottom:1px solid #eee}</style>
<h1>InsureSim — Session Report (fallback)</h1>
<p><em>Note: this is a locally-generated fallback report. The server-side version couldn't be fetched.</em></p>
<p><strong>Outcome:</strong> ${esc(outcome)}</p>
<p><strong>Summary:</strong> ${esc(summary)}</p>
${cover}
<h2>Stage scorecard</h2><table>${stageRows}</table>
<h2>Transcript</h2>${turns}`;
}

// v5: last-resort UI — just the download button — if the full debrief panel errored.
function renderMinimalDebriefActions() {
  const wrap = document.createElement('div');
  wrap.className = 'end-overlay';
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = 'Session ended';
  const actions = document.createElement('div');
  actions.className = 'debrief-actions';
  const dl = document.createElement('button');
  dl.className = 'download-btn';
  dl.textContent = '\u2193 Download report (HTML)';
  dl.addEventListener('click', downloadLog);
  const restart = document.createElement('button');
  restart.className = 'restart-btn';
  restart.textContent = 'Start a new session';
  restart.addEventListener('click', restartSession);
  actions.append(dl, restart);
  wrap.append(title, actions);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function outcomeTitle(o) {
  return ({
    success:            'Closed \u2014 link / agent requested on the correct product',
    walked:             'Ivan walked away',
    failed_optout:      'Ivan asked to opt out',
    failed_ignored:     'Ivan stopped responding',
    failed_stage:       'Stage failed',
    failed_missold:     'Mis-sold \u2014 wrong product for Ivan',
    failed_unfocused:   'Unfocused \u2014 no specific product was pitched',
    failed_exit_intent: 'Exit intent \u2014 recovery failed',
  })[o] || 'Session ended';
}

function outcomeIcon(o) {
  if (o === 'success')          return '\u2713';
  if (o === 'failed_unfocused') return '?';
  if (o === 'failed_stage')     return '!';
  return '\u2717';
}

function showInterimEnd(outcome, summary) {
  const overlay = document.createElement('div');
  overlay.className = 'end-overlay';
  overlay.id = 'interim-overlay';
  const icon = document.createElement('div');
  icon.className = 'end-icon';
  icon.textContent = outcomeIcon(outcome);
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = outcomeTitle(outcome);
  const sub = document.createElement('div');
  sub.className = 'end-sub';
  sub.textContent = `${summary}\n\nGenerating debrief\u2026`;
  overlay.append(icon, title, sub);
  messagesEl.appendChild(overlay);
  scrollToBottom();
}

function showDebriefOverlay(outcome, summary, debrief) {
  const interim = document.getElementById('interim-overlay');
  if (interim) interim.remove();

  const overlay = document.createElement('div');
  overlay.className = 'end-overlay';

  const icon = document.createElement('div');
  icon.className = 'end-icon';
  icon.textContent = outcomeIcon(outcome);
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = outcomeTitle(outcome);
  const sub = document.createElement('div');
  sub.className = 'end-sub';
  sub.textContent = summary;
  overlay.append(icon, title, sub);

  if (perStageScores.length > 0) {
    overlay.appendChild(makeSection('Per-stage scorecard', () => {
      const wrap = document.createElement('div');
      perStageScores.forEach(s => {
        const row = document.createElement('div');
        row.className = 'debrief-stage-row';
        const name = document.createElement('div'); name.className = 'stage-name'; name.textContent = `Stage ${s.stage}`;
        const score = document.createElement('div'); score.className = 'stage-score'; score.textContent = `avg ${s.avg.toFixed(1)} \u00b7 ${s.turns} turns`;
        row.append(name, score);
        wrap.appendChild(row);
      });
      return wrap;
    }));
  }

  // ── v4: product-fit review ───────────────────────────
  if (debrief?.needDiscovery) {
    overlay.appendChild(makeSection('Product-fit review', () => {
      const nd = debrief.needDiscovery;
      const wrap = document.createElement('div');
      wrap.className = 'debrief-needfit';
      const scoreRow = document.createElement('div');
      scoreRow.className = 'needfit-scores';
      const mk = (lbl, val) => {
        const cell = document.createElement('div'); cell.className = 'needfit-cell';
        const l = document.createElement('div'); l.className = 'needfit-label'; l.textContent = lbl;
        const v = document.createElement('div'); v.className = 'needfit-val'; v.textContent = val == null ? '\u2014' : `${val}/10`;
        cell.append(l, v); return cell;
      };
      scoreRow.append(mk('Discovery', nd.discovery_score), mk('Pitch fit', nd.pitch_fit_score));
      wrap.appendChild(scoreRow);
      if (nd.coaching_note) {
        const p = document.createElement('div'); p.className = 'needfit-line'; p.textContent = nd.coaching_note;
        wrap.appendChild(p);
      }
      return wrap;
    }));
  }

  // ── v4: cover reveal with full card ───────────────────
  if (debrief?.cover) {
    overlay.appendChild(makeSection("Ivan's real cover fit this session", () => {
      const wrap = document.createElement('div');
      wrap.className = 'debrief-need';
      const name = document.createElement('div'); name.className = 'a-name'; name.textContent = debrief.cover.shortName;
      const oneLiner = document.createElement('div'); oneLiner.className = 'a-desc'; oneLiner.textContent = debrief.cover.oneLiner;
      wrap.append(name, oneLiner);
      if (debrief.cover.need?.summary) {
        const p = document.createElement('div'); p.className = 'a-desc'; p.style.marginTop = '6px';
        p.textContent = 'Need: ' + debrief.cover.need.summary;
        wrap.appendChild(p);
      }
      return wrap;
    }));
  }

  if (debrief?.transition && debrief.transition.score != null) {
    overlay.appendChild(makeSection('Transition naturalness (hook \u2192 insurance)', () => {
      const wrap = document.createElement('div'); wrap.className = 'debrief-transition';
      const score = document.createElement('div'); score.className = 'ts-score'; score.textContent = `${debrief.transition.score}/10`;
      const rationale = document.createElement('div'); rationale.className = 'ts-rationale'; rationale.textContent = debrief.transition.rationale || '';
      wrap.append(score, rationale);
      return wrap;
    }));
  }

  if (debrief?.keyMoments?.length) {
    overlay.appendChild(makeSection('Key moments', () => {
      const wrap = document.createElement('div');
      debrief.keyMoments.forEach(m => {
        const block = document.createElement('div'); block.className = 'debrief-moment';
        const h = document.createElement('div'); h.className = 'm-headline'; h.textContent = `Turn ${m.turn} \u2014 ${m.headline || ''}`;
        const w = document.createElement('div'); w.className = 'm-what'; w.textContent = m.what_happened || '';
        const l = document.createElement('div'); l.className = 'm-lesson'; l.textContent = m.lesson || '';
        block.append(h, w, l);
        wrap.appendChild(block);
      });
      return wrap;
    }));
  }

  if (debrief?.archetype) {
    overlay.appendChild(makeSection('Persona this session', () => {
      const wrap = document.createElement('div'); wrap.className = 'debrief-archetype';
      const name = document.createElement('div'); name.className = 'a-name'; name.textContent = debrief.archetype.name;
      const desc = document.createElement('div'); desc.className = 'a-desc'; desc.textContent = debrief.archetype.description;
      wrap.append(name, desc);
      return wrap;
    }));
  }

  if (debrief?.exemplarBridge) {
    overlay.appendChild(makeSection('How a strong bridge could have read', () => {
      const wrap = document.createElement('div'); wrap.className = 'debrief-exemplar';
      wrap.textContent = debrief.exemplarBridge;
      return wrap;
    }));
  }

  const actions = document.createElement('div');
  actions.className = 'debrief-actions';
  const dl = document.createElement('button');
  dl.className = 'download-btn'; dl.textContent = '\u2193 Download report (HTML)';
  dl.addEventListener('click', downloadLog);
  const restart = document.createElement('button');
  restart.className = 'restart-btn'; restart.textContent = 'Start a new session';
  restart.addEventListener('click', restartSession);
  actions.append(dl, restart);
  overlay.appendChild(actions);

  messagesEl.appendChild(overlay);
  scrollToBottom();
}

// v5: each debrief section is isolated — a thrown error in one doesn't kill
// the rest. The failing section is replaced with a small note; the rest
// renders normally.
function makeSection(heading, contentFn) {
  const sec = document.createElement('div'); sec.className = 'debrief-section';
  const h = document.createElement('div'); h.className = 'debrief-h'; h.textContent = heading;
  sec.appendChild(h);
  try {
    const content = contentFn();
    if (content) sec.appendChild(content);
  } catch (e) {
    console.error(`Debrief section "${heading}" failed:`, e);
    const err = document.createElement('div');
    err.style.cssText = 'font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;';
    err.textContent = '(this section failed to render — see the downloadable report for full details)';
    sec.appendChild(err);
  }
  return sec;
}

// ── Restart ────────────────────────────────────────────────
function restartSession() {
  while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
  pip('pip1').className = 'stage-pip';
  pip('pip2').className = 'stage-pip';
  pip('pip3').className = 'stage-pip';
  resetState();
  stageBadge.textContent = 'Stage 1 \u00b7 Hook';
  stageBadge.className = 'stage-badge s1';
  stageLblTop.textContent = 'Stage 1 \u00b7 Hook';
  stageDisplay.textContent = 'Stage 1 / 3';
  scoreAvgEl.textContent = '\u2014';
  scoreCumEl.textContent = '\u2014';
  scoreBarEl.style.width = '0%';
  ignoreCountEl.classList.remove('visible');
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.value = '';
  startSession();
}

function downloadLog() {
  try {
    let html = cachedReportHtml;
    if (!html) {
      // Last-resort fallback — build minimal HTML from client state only
      html = buildFallbackReportHtml(
        'unknown',
        'Session report generated locally because the full server-side report was not available.',
        null
      );
    }
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insuresim-${sessionId}.html`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay so the download has time to start
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Download failed:', e);
    showSystemMsg("Couldn't start the download. Check your browser's pop-up / download permissions.");
  }
}

// ── DOM helpers ────────────────────────────────────────────
function addMessageBubble(side, text) {
  const wrap = document.createElement('div'); wrap.className = `msg ${side === 'bot' ? 'bot' : 'user'}`;
  const av = document.createElement('div'); av.className = 'msg-av'; av.textContent = side === 'bot' ? '\uD83C\uDFC0' : '\uD83D\uDC64';
  const body = document.createElement('div'); body.className = 'msg-body';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble'; bubble.textContent = text;
  body.appendChild(bubble);
  wrap.append(av, body);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function addReadIgnoredHint() {
  const hint = document.createElement('div'); hint.className = 'read-ignored-hint';
  const t = new Date();
  hint.textContent = `Read ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')} \u00b7 No reply`;
  messagesEl.appendChild(hint); scrollToBottom();
}

function addTypingIndicator() {
  const wrap = document.createElement('div'); wrap.className = 'msg bot';
  const av = document.createElement('div'); av.className = 'msg-av'; av.textContent = '\uD83C\uDFC0';
  const body = document.createElement('div'); body.className = 'msg-body';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  const typing = document.createElement('div'); typing.className = 'typing';
  for (let i = 0; i < 3; i++) typing.appendChild(document.createElement('span'));
  bubble.appendChild(typing); body.appendChild(bubble);
  wrap.append(av, body); messagesEl.appendChild(wrap); scrollToBottom();
  return wrap;
}

function showSystemMsg(text) {
  const hint = document.createElement('div'); hint.className = 'read-ignored-hint';
  hint.textContent = text;
  messagesEl.appendChild(hint); scrollToBottom();
}

function updateIgnoreCounter() {
  if (consecutiveIgnores > 0) {
    ignoreCountEl.classList.add('visible');
    ignoreCountEl.textContent = `\uD83D\uDCED ${consecutiveIgnores}/${MAX_IGNORES} ignored`;
  } else {
    ignoreCountEl.classList.remove('visible');
  }
}

function reEnableInput() {
  if (sessionEnded) return;
  inputEl.disabled = false; sendBtn.disabled = false; inputEl.focus();
}

function scrollToBottom() {
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}
