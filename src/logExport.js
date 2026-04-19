// src/logExport.js
// Renders session audit logs as polished, printable HTML documents.
// Used for both the per-session trainee download and the facilitator's full export.
// No external dependencies. Output is safe to print to PDF.

import { ARCHETYPES } from './personas.js';
import { INSURANCE_NEEDS } from './insuranceNeeds.js';

const OUTCOME_META = {
  success:          { label: 'Closed — correct product, handoff requested',    tone: 'good',    icon: '✓' },
  failed_missold:   { label: 'Mis-sold — closed the wrong product type',       tone: 'bad',     icon: '✗' },
  failed_unfocused: { label: 'Closed without a specific product',              tone: 'warn',    icon: '!' },
  walked:           { label: 'Walked away — insurance came up too early',      tone: 'bad',     icon: '✗' },
  failed_optout:    { label: 'Ivan asked to opt out',                          tone: 'bad',     icon: '✗' },
  failed_ignored:   { label: 'Ivan stopped responding',                        tone: 'bad',     icon: '✗' },
  failed_stage:     { label: 'Stage failed without enough engagement',         tone: 'warn',    icon: '!' },
  unknown:          { label: 'Ended (no outcome recorded)',                    tone: 'neutral', icon: '·' },
};

// ─── Minimal safe HTML escape ───────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtTs(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function fmtDuration(startMs, endMs) {
  if (!startMs) return '—';
  const end = endMs || Date.now();
  const seconds = Math.floor((end - startMs) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─── Session → HTML body fragment ───────────────────────────────
export function renderSessionBody(session, { includeTranscript = true } = {}) {
  if (!session) return '<div class="empty">No session data.</div>';
  const outcome = session.outcome || 'unknown';
  const meta = OUTCOME_META[outcome] || OUTCOME_META.unknown;
  const arch = ARCHETYPES[session.archetypeKey];
  const need = INSURANCE_NEEDS[session.insuranceNeedKey];
  const debrief = session.debrief || {};
  const turns = session.turns || [];
  const finalPsych = session.finalState?.psych || {};

  const scoredTurns = turns.filter(t => typeof t.score === 'number');
  const avgScore = scoredTurns.length
    ? (scoredTurns.reduce((a, t) => a + t.score, 0) / scoredTurns.length).toFixed(1)
    : '—';

  const breachTurns  = turns.filter(t => (t.severeBreach?.length > 0) || t.judgeBreach).length;
  const privateRefs  = turns.reduce((a, t) => a + (t.privateRefs?.length || 0), 0);
  const wrongPitches = turns.filter(t => t.pitchType && session.insuranceNeedKey && t.pitchType !== 'generic' && t.pitchType !== 'both' && t.pitchType !== session.insuranceNeedKey).length;

  return `
  <section class="session">
    <header class="session-head tone-${meta.tone}">
      <div class="outcome-icon">${esc(meta.icon)}</div>
      <div class="session-head-body">
        <div class="session-head-row">
          <h2>Session ${esc(session.sessionId)}</h2>
          <span class="badge badge-${meta.tone}">${esc(meta.label)}</span>
        </div>
        <div class="session-head-meta">
          <span>Started ${esc(fmtTs(session.startedAt))}</span>
          <span>·</span>
          <span>Duration ${esc(fmtDuration(session.startedAt, session.endedAt))}</span>
          <span>·</span>
          <span>${turns.length} turns</span>
        </div>
      </div>
    </header>

    <section class="kv-grid">
      <div class="kv">
        <div class="kv-key">Ivan's archetype today</div>
        <div class="kv-val">${esc(arch?.name || session.archetypeKey || 'Unknown')}</div>
        <div class="kv-sub">${esc(arch?.description || '')}</div>
      </div>
      <div class="kv">
        <div class="kv-key">Ivan's real insurance need</div>
        <div class="kv-val">${esc(need?.shortName || session.insuranceNeedKey || 'Unknown')}</div>
        <div class="kv-sub">${esc(need?.oneLiner || '')}</div>
      </div>
      <div class="kv">
        <div class="kv-key">Average turn score</div>
        <div class="kv-val big">${esc(avgScore)}<span class="unit"> / 10</span></div>
      </div>
      <div class="kv">
        <div class="kv-key">Final psych state</div>
        <div class="kv-val small">
          Trust ${esc(finalPsych.trust ?? '—')} · Engagement ${esc(finalPsych.engagement ?? '—')} · Creepiness ${esc(finalPsych.creepiness ?? '—')}
        </div>
      </div>
      <div class="kv">
        <div class="kv-key">Privacy signals</div>
        <div class="kv-val small">
          ${breachTurns} severe · ${privateRefs} minor references
        </div>
      </div>
      <div class="kv">
        <div class="kv-key">Wrong-product pitches</div>
        <div class="kv-val small">${wrongPitches}</div>
      </div>
    </section>

    ${renderStageScores(session.finalState?.perStageScores || debrief.stageScores)}
    ${renderDebrief(debrief)}
    ${includeTranscript ? renderTranscript(turns) : ''}
  </section>`;
}

function renderStageScores(stageScores) {
  if (!stageScores || !Array.isArray(stageScores) || stageScores.length === 0) return '';
  const rows = stageScores.map(s => `
    <tr>
      <td>Stage ${esc(s.stage)}</td>
      <td>${esc(s.turns || 0)}</td>
      <td>${esc((s.avg ?? 0).toFixed ? s.avg.toFixed(1) : s.avg)}</td>
      <td>${esc(s.total ?? '—')}</td>
    </tr>`).join('');
  return `
    <section class="block">
      <h3>Per-stage scorecard</h3>
      <table class="scorecard">
        <thead><tr><th>Stage</th><th>Turns</th><th>Avg / 10</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderDebrief(debrief) {
  if (!debrief || Object.keys(debrief).length === 0) return '';
  const parts = [];

  if (debrief.needDiscovery) {
    const nd = debrief.needDiscovery;
    parts.push(`
      <div class="debrief-block">
        <h4>Product-fit review</h4>
        <div class="pf-grid">
          <div class="pf-cell"><div class="pf-label">Discovery score</div><div class="pf-val">${esc(nd.discovery_score ?? '—')}/10</div></div>
          <div class="pf-cell"><div class="pf-label">Pitch-fit score</div><div class="pf-val">${esc(nd.pitch_fit_score ?? '—')}/10</div></div>
        </div>
        <p><strong>Summary.</strong> ${esc(nd.summary || '')}</p>
        <p><strong>What Ivan signalled.</strong> ${esc(nd.what_ivan_signalled || '')}</p>
        <p><strong>What the seller pitched.</strong> ${esc(nd.what_seller_pitched || '')}</p>
        <p><strong>Coaching note.</strong> ${esc(nd.coaching_note || '')}</p>
      </div>`);
  }

  if (debrief.transition?.score != null) {
    parts.push(`
      <div class="debrief-block">
        <h4>Hook → insurance transition</h4>
        <div class="pf-grid"><div class="pf-cell"><div class="pf-label">Naturalness</div><div class="pf-val">${esc(debrief.transition.score)}/10</div></div></div>
        <p>${esc(debrief.transition.rationale || '')}</p>
        ${debrief.transition.best_bridge_moment ? `<p><strong>Best bridge.</strong> ${esc(debrief.transition.best_bridge_moment)}</p>` : ''}
        ${debrief.transition.weakest_moment    ? `<p><strong>Weakest moment.</strong> ${esc(debrief.transition.weakest_moment)}</p>` : ''}
      </div>`);
  }

  if (debrief.keyMoments?.length) {
    const moments = debrief.keyMoments.map(m => `
      <li>
        <div class="km-head"><strong>Turn ${esc(m.turn)}</strong> — ${esc(m.headline || '')}</div>
        <div class="km-what">${esc(m.what_happened || '')}</div>
        <div class="km-lesson"><em>Lesson:</em> ${esc(m.lesson || '')}</div>
      </li>`).join('');
    parts.push(`
      <div class="debrief-block">
        <h4>Key moments</h4>
        <ul class="moments">${moments}</ul>
      </div>`);
  }

  if (debrief.exemplarBridge) {
    parts.push(`
      <div class="debrief-block">
        <h4>Exemplar bridge (what a strong transition could have read like)</h4>
        <blockquote>${esc(debrief.exemplarBridge)}</blockquote>
      </div>`);
  }

  if (parts.length === 0) return '';
  return `<section class="block"><h3>Debrief</h3>${parts.join('')}</section>`;
}

function renderTranscript(turns) {
  if (!turns?.length) return '<section class="block"><h3>Transcript</h3><div class="empty">No turns recorded.</div></section>';

  const rows = turns.map((t, i) => {
    const annotations = [];
    if (t.severeBreach?.length) annotations.push(`<span class="anno anno-bad">PRIVACY BREACH: ${esc(t.severeBreach.join('; '))}</span>`);
    if (t.judgeBreach)          annotations.push(`<span class="anno anno-bad">JUDGE-FLAGGED BREACH: ${esc(t.judgeBreach.label || '')}</span>`);
    if (t.privateRefs?.length)  annotations.push(`<span class="anno anno-warn">PRIVATE REFS: ${esc(t.privateRefs.join('; '))}</span>`);
    if (t.confirmingQ?.length)  annotations.push(`<span class="anno anno-warn">CONFIRMING Q: ${esc(t.confirmingQ.join('; '))}</span>`);
    if (t.probeDirection && t.probeDirection !== 'neutral') annotations.push(`<span class="anno anno-info">PROBE: ${esc(t.probeDirection)}</span>`);
    if (t.pitchType)            annotations.push(`<span class="anno anno-info">PITCH: ${esc(t.pitchType)}</span>`);
    if (t.wrongCloseAttempt)    annotations.push(`<span class="anno anno-bad">WRONG-PRODUCT CLOSE ATTEMPT</span>`);
    if (t.walked)               annotations.push(`<span class="anno anno-bad">IVAN WALKED</span>`);
    if (t.insuranceMention)     annotations.push(`<span class="anno anno-info">INSURANCE MENTIONED</span>`);
    if (t.legitimacy)           annotations.push(`<span class="anno anno-info">LEGITIMACY CHALLENGED: ${esc(t.legitimacy)}</span>`);
    if (t.optOut)               annotations.push(`<span class="anno anno-bad">OPT-OUT</span>`);

    const userBlock = `
      <div class="turn-side seller">
        <div class="turn-who">Seller (turn ${esc(t.turn ?? i + 1)})</div>
        <div class="turn-body">${esc(t.userMessage || '')}</div>
        ${annotations.length ? `<div class="annotations">${annotations.join(' ')}</div>` : ''}
        <div class="turn-meta">
          Stage ${esc(t.stage ?? '—')} · Quality: ${esc(t.quality ?? '—')} · Score: ${esc(t.score ?? '—')}/10
        </div>
      </div>`;

    const ivanBlock = t.ignored || !t.reply
      ? `<div class="turn-side ivan ignored">
           <div class="turn-who">Ivan</div>
           <div class="turn-body empty">— Ivan did not reply (${esc(t.ignoringReason || 'ignored')})</div>
         </div>`
      : `<div class="turn-side ivan">
           <div class="turn-who">Ivan</div>
           <div class="turn-body">${esc(t.reply)}</div>
           ${t.thought ? `<div class="turn-thought"><em>Internal thought:</em> ${esc(t.thought)}</div>` : ''}
         </div>`;

    return `<li class="turn">${userBlock}${ivanBlock}</li>`;
  }).join('');

  return `
    <section class="block">
      <h3>Full transcript</h3>
      <ol class="turns">${rows}</ol>
    </section>`;
}

// ─── Full-page HTML wrapper ────────────────────────────────────
export function renderSessionPage(session) {
  return wrapPage(`Session ${esc(session?.sessionId || '')}`, renderSessionBody(session));
}

export function renderAllSessionsPage(sessions) {
  const body = `
    <section class="overview">
      <h1>InsureSim — Facilitator Log</h1>
      <div class="overview-meta">Exported ${esc(fmtTs(Date.now()))} · ${sessions.length} sessions</div>
      ${renderOverviewTable(sessions)}
    </section>
    ${sessions.map(s => renderSessionBody(s, { includeTranscript: true })).join('\n<hr class="sep">\n')}`;
  return wrapPage(`InsureSim Facilitator Log (${sessions.length} sessions)`, body);
}

function renderOverviewTable(sessions) {
  if (!sessions.length) return '<div class="empty">No sessions recorded yet.</div>';
  const rows = sessions.map(s => {
    const outcome = s.outcome || 'unknown';
    const meta = OUTCOME_META[outcome] || OUTCOME_META.unknown;
    const arch = ARCHETYPES[s.archetypeKey];
    const need = INSURANCE_NEEDS[s.insuranceNeedKey];
    const turns = s.turns?.length || 0;
    return `
      <tr>
        <td class="mono">${esc((s.sessionId || '').slice(0, 24))}</td>
        <td>${esc(fmtTs(s.startedAt))}</td>
        <td>${esc(arch?.name || '—')}</td>
        <td>${esc(need?.shortName || '—')}</td>
        <td>${turns}</td>
        <td class="tone-${meta.tone}">${esc(meta.label)}</td>
      </tr>`;
  }).join('');
  return `
    <table class="overview-table">
      <thead><tr><th>Session ID</th><th>Started</th><th>Archetype</th><th>Need</th><th>Turns</th><th>Outcome</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Shared page shell ─────────────────────────────────────────
function wrapPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main class="page">
    <div class="page-header">
      <div class="brand">InsureSim</div>
      <div class="page-subtitle">Sales-training session report</div>
    </div>
    ${bodyHtml}
    <footer class="page-footer">
      Generated by InsureSim · For internal training use only · Not a record of real customer data
    </footer>
  </main>
</body>
</html>`;
}

const PAGE_CSS = `
:root {
  --bg: #fafaf7;
  --surface: #ffffff;
  --border: #e5e4dd;
  --text: #1a1a18;
  --text-sub: #5f5f58;
  --good: #0f7a3a;
  --bad:  #b42828;
  --warn: #a66a06;
  --neutral: #3c3c3a;
  --info: #1e5aa8;
  --accent: #1a1a18;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 15px; line-height: 1.55; }
.page { max-width: 960px; margin: 0 auto; padding: 48px 32px 80px; }
.page-header { border-bottom: 2px solid var(--text); padding-bottom: 18px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: baseline; }
.brand { font-size: 28px; font-weight: 600; letter-spacing: -0.01em; }
.page-subtitle { color: var(--text-sub); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; }
.overview { margin-bottom: 56px; }
.overview h1 { margin: 0 0 6px; font-size: 24px; font-weight: 600; }
.overview-meta { color: var(--text-sub); font-size: 13px; margin-bottom: 20px; }

.session { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; margin-bottom: 32px; }
.session-head { display: flex; gap: 20px; align-items: flex-start; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
.session-head-body { flex: 1; }
.session-head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
.session-head h2 { margin: 0; font-size: 18px; font-weight: 600; font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0; }
.session-head-meta { color: var(--text-sub); font-size: 13px; display: flex; gap: 8px; flex-wrap: wrap; }
.outcome-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 600; flex-shrink: 0; color: var(--surface); }
.tone-good .outcome-icon { background: var(--good); }
.tone-bad  .outcome-icon { background: var(--bad);  }
.tone-warn .outcome-icon { background: var(--warn); }
.tone-neutral .outcome-icon { background: var(--neutral); }

.badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
.badge-good { background: #e1f2e7; color: var(--good); }
.badge-bad  { background: #f9e3e3; color: var(--bad); }
.badge-warn { background: #f9ecd0; color: var(--warn); }
.badge-neutral { background: #eae9e3; color: var(--neutral); }

.kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 28px; }
.kv { border-left: 3px solid var(--border); padding: 4px 0 4px 14px; }
.kv-key { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-sub); margin-bottom: 4px; }
.kv-val { font-size: 16px; font-weight: 500; }
.kv-val.big { font-size: 28px; font-weight: 600; }
.kv-val.small { font-size: 14px; font-weight: 400; }
.kv-val .unit { font-size: 14px; color: var(--text-sub); font-weight: 400; }
.kv-sub { font-size: 13px; color: var(--text-sub); margin-top: 4px; }

.block { margin-top: 32px; }
.block h3 { margin: 0 0 16px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 8px; font-weight: 600; }
.block h4 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }

.scorecard { width: 100%; border-collapse: collapse; font-size: 14px; }
.scorecard th, .scorecard td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
.scorecard th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-sub); font-weight: 500; }

.debrief-block { margin-bottom: 22px; padding: 16px 18px; background: #fdfdfb; border: 1px solid var(--border); border-radius: 6px; }
.debrief-block p { margin: 6px 0; font-size: 14px; }
.debrief-block blockquote { margin: 8px 0 0; padding: 12px 16px; background: var(--bg); border-left: 3px solid var(--accent); font-style: italic; font-size: 14px; }
.pf-grid { display: flex; gap: 24px; margin-bottom: 12px; }
.pf-cell { }
.pf-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-sub); }
.pf-val { font-size: 22px; font-weight: 600; }
.moments { list-style: none; padding: 0; margin: 0; }
.moments li { padding: 10px 0; border-bottom: 1px dashed var(--border); }
.moments li:last-child { border-bottom: none; }
.km-head { font-size: 14px; margin-bottom: 4px; }
.km-what { font-size: 14px; color: var(--text-sub); }
.km-lesson { font-size: 13px; margin-top: 6px; }

.turns { list-style: none; padding: 0; margin: 0; counter-reset: turn; }
.turn { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.turn-side { padding: 12px 14px; border-radius: 6px; }
.turn-side.seller { background: #f5f5ee; }
.turn-side.ivan   { background: #fff; border: 1px solid var(--border); }
.turn-side.ivan.ignored { background: repeating-linear-gradient(135deg, #fafaf7 0 8px, #f0efe8 8px 16px); }
.turn-who { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-sub); margin-bottom: 6px; font-weight: 600; }
.turn-body { white-space: pre-wrap; font-size: 14px; }
.turn-body.empty { color: var(--text-sub); font-style: italic; }
.turn-thought { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 12px; color: var(--text-sub); }
.turn-meta { margin-top: 8px; font-size: 11px; color: var(--text-sub); }
.annotations { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.anno { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.anno-bad  { background: #f9e3e3; color: var(--bad); }
.anno-warn { background: #f9ecd0; color: var(--warn); }
.anno-info { background: #e1ecf7; color: var(--info); }

.overview-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 12px; }
.overview-table th, .overview-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.overview-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-sub); font-weight: 600; }
.overview-table td.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.overview-table td.tone-good { color: var(--good); font-weight: 500; }
.overview-table td.tone-bad  { color: var(--bad);  font-weight: 500; }
.overview-table td.tone-warn { color: var(--warn); font-weight: 500; }

.sep { margin: 40px 0; border: 0; border-top: 2px solid var(--border); }
.empty { color: var(--text-sub); font-style: italic; padding: 12px 0; }
.page-footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--text-sub); font-size: 12px; text-align: center; }

@media print {
  body { background: #fff; }
  .page { max-width: none; padding: 0 16px; }
  .session { border: none; padding: 0; box-shadow: none; }
  .block h3 { break-after: avoid; }
  .turn { break-inside: avoid; }
}
@media (max-width: 700px) {
  .kv-grid { grid-template-columns: 1fr; }
  .turn { grid-template-columns: 1fr; }
}
`;
