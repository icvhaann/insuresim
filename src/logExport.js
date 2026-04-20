// src/logExport.js
// Renders session data as polished HTML — used for:
//   (a) per-session "download my report" link shown at the end of a session
//   (b) facilitator-wide export of all sessions in memory
//
// v4: updated for the 5-cover model. Shows the TRUE cover prominently in the
// debrief with its need, selling points, trade-offs, and optional bundles.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const OUTCOME_META = {
  success:            { icon: '✓', color: '#2ba566', label: 'Closed — link / agent requested on the correct product' },
  walked:             { icon: '✗', color: '#c0392b', label: 'Ivan walked away' },
  failed_optout:      { icon: '!', color: '#c0392b', label: 'Ivan asked to opt out' },
  failed_ignored:     { icon: '!', color: '#c0392b', label: 'Ivan stopped responding' },
  failed_stage:       { icon: '!', color: '#c0392b', label: 'Stage failed' },
  failed_missold:     { icon: '✗', color: '#c0392b', label: 'Mis-sold — closed on the WRONG product for Ivan' },
  failed_unfocused:   { icon: '?', color: '#d88b1a', label: 'Unfocused — no specific product was pitched' },
  failed_exit_intent: { icon: '✗', color: '#c0392b', label: 'Ivan signalled exit intent and the recovery did not land' },
};

function baseStyle() {
  return `
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f6fa; color: #222; padding: 40px 20px; line-height: 1.55; }
.report { max-width: 860px; margin: 0 auto; background: #fff; padding: 48px 56px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
h1 { font-size: 26px; margin-bottom: 6px; color: #111; }
h2 { font-size: 19px; margin: 28px 0 12px; color: #111; border-bottom: 1px solid #eee; padding-bottom: 6px; }
h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin: 22px 0 8px; }
.meta { color: #888; font-size: 13px; margin-bottom: 16px; }
.outcome { padding: 14px 18px; border-radius: 6px; margin-bottom: 20px; display: flex; gap: 12px; align-items: center; }
.outcome-icon { width: 30px; height: 30px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; flex-shrink: 0; }
.section { margin-bottom: 26px; }
.grid { display: grid; grid-template-columns: 160px 1fr; gap: 8px 20px; font-size: 14px; }
.grid .k { color: #666; font-weight: 500; }
.stage-row { padding: 10px 14px; background: #f9fafb; border-radius: 5px; margin-bottom: 6px; display: flex; justify-content: space-between; font-size: 14px; }
.transcript { background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; max-height: 420px; overflow-y: auto; font-size: 13px; }
.turn { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.turn:last-child { border-bottom: none; }
.turn-h { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
.turn-seller { color: #2c5aa0; }
.turn-ivan { color: #333; }
.moment { padding: 10px 14px; background: #f9fafb; border-left: 3px solid #4a82f0; border-radius: 0 5px 5px 0; margin-bottom: 8px; }
.moment-h { font-size: 12px; color: #4a82f0; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-weight: 600; }
.cover-card { padding: 20px 22px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 14px; }
.cover-card h3 { margin-top: 0; color: #4a82f0; }
.cover-card ul { margin: 8px 0 12px 18px; }
.cover-card li { margin-bottom: 3px; font-size: 14px; }
.pill { display: inline-block; padding: 3px 10px; border-radius: 20px; background: #eef2f7; color: #333; font-size: 12px; margin-right: 6px; }
.pill.accent { background: #d3ebff; color: #2c5aa0; }
.pill.warn { background: #fcefc8; color: #8a5a10; }
.pill.danger { background: #fde0e0; color: #8a2020; }
.bundle { display: inline-block; padding: 6px 12px; border: 1px dashed #b6b6b6; border-radius: 4px; margin: 3px 6px 3px 0; font-size: 12px; color: #555; }
.bundle-promo { font-style: italic; color: #888; font-size: 11px; margin-left: 4px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #555; }
@media print {
  body { background: #fff; padding: 0; }
  .report { box-shadow: none; padding: 20px; }
}
</style>`;
}

function outcomeBanner(outcome) {
  const meta = OUTCOME_META[outcome] || { icon: '·', color: '#666', label: 'Session ended' };
  return `<div class="outcome" style="background: ${meta.color}22; border: 1px solid ${meta.color}55;">
    <div class="outcome-icon" style="background: ${meta.color};">${meta.icon}</div>
    <div><strong>${esc(meta.label)}</strong><br><span style="color:#666;font-size:12px;">Outcome code: ${esc(outcome || 'unknown')}</span></div>
  </div>`;
}

function coverCard(cover) {
  if (!cover) return '';
  const sellingPoints = (cover.sellingPoints || []).map(p => `<li>${esc(p)}</li>`).join('');
  const tradeOffs = (cover.tradeOffs || []).map(p => `<li>${esc(p)}</li>`).join('');
  const bundles = (cover.optionalBundles || [])
    .map(b => `<span class="bundle">${esc(b.label)}<span class="bundle-promo">${esc(b.note || '')}</span></span>`)
    .join('');

  return `<div class="cover-card">
    <h3>${esc(cover.shortName)}</h3>
    <div class="mono">${esc(cover.category)} · ${esc(cover.key)}</div>
    <p style="margin:10px 0 14px;font-size:14px;">${esc(cover.oneLiner)}</p>
    <div><strong style="font-size:13px;">Need this cover addresses:</strong> ${esc(cover.need?.label || '')}</div>
    <p style="font-size:13px;color:#555;margin:4px 0 14px;">${esc(cover.need?.summary || '')}</p>
    <h3 style="margin-top:14px;">Key selling points</h3>
    <ul>${sellingPoints}</ul>
    <h3>Why superior vs alternatives</h3>
    <p style="font-size:14px;">${esc(cover.whySuperiorVsAlternatives || '')}</p>
    <h3>Trade-offs</h3>
    <ul>${tradeOffs}</ul>
    <h3>Optional bundles</h3>
    <div>${bundles || '<span class="mono">None</span>'}</div>
  </div>`;
}

function transcriptBlock(turns) {
  if (!turns?.length) return '<div class="mono">No turns recorded.</div>';
  const rows = turns.map((t, i) => {
    const seller = esc(t.userMessage || '');
    const ivanText = t.reply ? esc(t.reply) : (t.ignored ? '<em style="color:#888;">[no reply]</em>' : '<em style="color:#888;">[none]</em>');
    return `<div class="turn">
      <div class="turn-h">Turn ${t.turn ?? i + 1} · Stage ${t.stage} · Score ${t.score ?? '—'} · Quality ${t.quality ?? '—'}</div>
      <div class="turn-seller"><strong>Seller:</strong> ${seller}</div>
      <div class="turn-ivan"><strong>Ivan:</strong> ${ivanText}</div>
      ${t.disclosedFact ? `<div class="mono">Disclosed fact: ${esc(t.disclosedFact)}</div>` : ''}
      ${t.validator?.regenAttempted ? `<div class="mono" style="color:#8a5a10;">⚠ Grounding regenerated</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="transcript">${rows}</div>`;
}

export function renderSessionPage(session, opts = {}) {
  const { forDownload = false } = opts;
  const arch = session?.archetypeKey || '—';
  const coverKey = session?.coverKey || '—';
  const debrief = session?.debrief;
  const cover = debrief?.cover;
  const startedAt = session?.startedAt ? new Date(session.startedAt).toISOString() : '—';

  const stageRows = (debrief?.stageScores || []).map(s =>
    `<div class="stage-row"><span>Stage ${s.stage}</span><span class="mono">avg ${s.avg} · ${s.turns} turns</span></div>`
  ).join('');

  const moments = (debrief?.keyMoments || []).map(m =>
    `<div class="moment">
      <div class="moment-h">Turn ${m.turn} — ${esc(m.headline || '')}</div>
      <div style="font-size:13px;">${esc(m.what_happened || '')}</div>
      <div style="font-size:12px;color:#666;font-style:italic;margin-top:4px;">${esc(m.lesson || '')}</div>
    </div>`
  ).join('');

  const transition = debrief?.transition;
  const need = debrief?.needDiscovery;

  return `<!doctype html><meta charset="utf-8"><title>InsureSim session report</title>
${baseStyle()}
<div class="report">
  <h1>InsureSim — Session Report</h1>
  <div class="meta">Session ID: <span class="mono">${esc(session?.sessionId || '')}</span> · Started ${esc(startedAt)}</div>

  ${outcomeBanner(session?.outcome)}

  <div class="section">
    <h2>Session summary</h2>
    <div class="grid">
      <div class="k">Archetype</div><div>${esc(debrief?.archetype?.name || arch)}</div>
      <div class="k">True cover fit</div><div>${esc(cover?.shortName || coverKey)}</div>
      <div class="k">Outcome</div><div>${esc(session?.outcome || '—')}</div>
      <div class="k">Total turns</div><div>${esc(String(session?.turns?.length || 0))}</div>
    </div>
  </div>

  ${transition ? `<div class="section">
    <h2>Transition naturalness (hook → insurance)</h2>
    <div style="font-size:28px;font-weight:500;color:#4a82f0;">${esc(String(transition.score ?? '—'))}<span style="font-size:16px;color:#888;"> / 10</span></div>
    <p style="font-size:13px;color:#555;margin-top:6px;">${esc(transition.rationale || '')}</p>
  </div>` : ''}

  ${need ? `<div class="section">
    <h2>Product-fit review</h2>
    <div class="grid">
      <div class="k">Discovery score</div><div>${esc(String(need.discovery_score ?? '—'))}<span style="color:#888;"> / 10</span></div>
      <div class="k">Pitch-fit score</div><div>${need.pitch_fit_score == null ? '<span class="mono">— (no specific pitch)</span>' : esc(String(need.pitch_fit_score)) + ' / 10'}</div>
    </div>
    <p style="font-size:13px;color:#555;margin-top:10px;font-style:italic;">${esc(need.coaching_note || '')}</p>
  </div>` : ''}

  ${moments ? `<div class="section"><h2>Key moments</h2>${moments}</div>` : ''}

  ${stageRows ? `<div class="section"><h2>Stage scorecard</h2>${stageRows}</div>` : ''}

  ${cover ? `<div class="section"><h2>Ivan's true cover this session</h2>${coverCard(cover)}</div>` : ''}

  ${debrief?.exemplarBridge ? `<div class="section">
    <h2>A strong bridge could have read</h2>
    <div style="padding:14px 18px;background:#f0faf5;border-left:3px solid #2ba566;border-radius:0 5px 5px 0;font-style:italic;font-size:14px;">
      "${esc(debrief.exemplarBridge)}"
    </div>
  </div>` : ''}

  <div class="section">
    <h2>Transcript</h2>
    ${transcriptBlock(session?.turns || [])}
  </div>

  ${forDownload ? '<div style="text-align:center;color:#888;font-size:11px;margin-top:40px;">Print or Save-as-PDF from your browser to archive.</div>' : ''}
</div>`;
}

export function renderAllSessionsPage(sessions) {
  const rows = (sessions || []).map(s => {
    const meta = OUTCOME_META[s.outcome] || {};
    const cover = s.debrief?.cover?.shortName || s.coverKey || '—';
    const duration = s.endedAt && s.startedAt
      ? Math.round((s.endedAt - s.startedAt) / 60000) + ' min'
      : '—';
    return `<tr>
      <td class="mono">${esc(s.sessionId || '')}</td>
      <td>${esc(s.archetypeKey || '—')}</td>
      <td>${esc(cover)}</td>
      <td style="color:${meta.color || '#666'};">${esc(s.outcome || '—')}</td>
      <td>${esc(String(s.turns?.length || 0))}</td>
      <td>${esc(duration)}</td>
      <td><a href="/api/session/report.html?sessionId=${encodeURIComponent(s.sessionId)}">view</a></td>
    </tr>`;
  }).join('');

  return `<!doctype html><meta charset="utf-8"><title>InsureSim — facilitator log</title>
${baseStyle()}
<div class="report">
  <h1>InsureSim — Facilitator Log</h1>
  <div class="meta">${(sessions || []).length} sessions in memory (capped at 200, cleared on restart)</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#f0f2f5;">
      <th style="text-align:left;padding:8px;">Session</th>
      <th style="text-align:left;padding:8px;">Archetype</th>
      <th style="text-align:left;padding:8px;">True cover</th>
      <th style="text-align:left;padding:8px;">Outcome</th>
      <th style="text-align:left;padding:8px;">Turns</th>
      <th style="text-align:left;padding:8px;">Duration</th>
      <th></th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#888;">No sessions</td></tr>'}</tbody>
  </table>
</div>`;
}
