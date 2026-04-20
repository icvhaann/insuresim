// src/factsheet.js
//
// v5: structured insurance fact sheets. Renders the 5-cover catalog as
// polished, printable HTML — one per cover, plus a combined pack.
//
// Used by:
//   • GET /api/factsheet/:coverKey.html        — individual cover fact sheet
//   • GET /facilitator/factsheets              — all 5 in one printable page
//   • embedded into debrief overlay (client renders just the relevant one)

import { COVERS, COVER_KEYS } from './covers.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function baseStyle() {
  return `<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f6fa; color: #222; padding: 40px 20px; line-height: 1.55; }
.sheet { max-width: 820px; margin: 0 auto 30px; background: #fff; padding: 40px 48px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.masthead { border-bottom: 2px solid #2c5aa0; padding-bottom: 12px; margin-bottom: 24px; }
.masthead .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #2c5aa0; font-weight: 600; }
.masthead h1 { font-size: 28px; margin-top: 4px; color: #111; }
.masthead .tagline { color: #666; font-size: 14px; margin-top: 4px; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #888; }
h2 { font-size: 15px; margin: 22px 0 10px; color: #111; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #eee; padding-bottom: 4px; }
.need-callout { padding: 14px 18px; background: #eef5ff; border-left: 3px solid #2c5aa0; border-radius: 0 5px 5px 0; margin-bottom: 14px; }
.need-callout .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #2c5aa0; font-weight: 600; }
.need-callout .summary { margin-top: 4px; font-size: 14px; color: #333; }
ul { margin: 8px 0 12px 22px; }
li { margin-bottom: 4px; font-size: 14px; }
.pill { display: inline-block; padding: 2px 10px; border-radius: 20px; background: #eef2f7; color: #333; font-size: 11px; margin-right: 4px; letter-spacing: 0.02em; }
.pill.medical { background: #d3ebff; color: #1b5080; }
.pill.ci      { background: #fde0e0; color: #8a2020; }
.pill.pa      { background: #ffeccc; color: #8a5a10; }
.pill.di      { background: #e4d3ff; color: #4a2a8a; }
.pill.saver   { background: #cff6df; color: #1a6e40; }
.bundle { display: inline-block; padding: 6px 12px; border: 1px dashed #b6b6b6; border-radius: 4px; margin: 4px 6px 4px 0; font-size: 12px; color: #444; background: #fafafa; }
.bundle .note { color: #888; font-style: italic; font-size: 10px; margin-left: 6px; }
.superior { padding: 12px 16px; background: #f0faf5; border-left: 3px solid #2ba566; border-radius: 0 5px 5px 0; font-size: 14px; margin: 10px 0; }
.tradeoffs { padding: 12px 16px; background: #fff7eb; border-left: 3px solid #d88b1a; border-radius: 0 5px 5px 0; margin: 10px 0; }
.tradeoffs li { margin-left: 0; list-style-position: inside; }
.footer { text-align: center; color: #aaa; font-size: 11px; margin-top: 24px; }
.print-hint { text-align: center; padding: 10px; font-size: 12px; color: #666; }
.print-hint a { color: #2c5aa0; text-decoration: none; }
@media print {
  body { background: #fff; padding: 0; }
  .sheet { box-shadow: none; padding: 20px 0; margin: 0; border-radius: 0; }
  .print-hint, .print-btn { display: none; }
}
.print-btn { position: fixed; top: 12px; right: 12px; background: #2c5aa0; color: #fff; border: none; padding: 8px 16px; border-radius: 5px; font-size: 13px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
</style>`;
}

function categoryPillClass(category) {
  if (/medical|hospital_indemnity/.test(category)) return 'medical';
  if (/critical/.test(category))      return 'ci';
  if (/personal_accident|sports/.test(category)) return 'pa';
  if (/disability/.test(category))    return 'di';
  if (/savings|saver/.test(category)) return 'saver';
  return '';
}

function renderOneSheet(cover) {
  const pillClass = categoryPillClass(cover.category);
  const sellingPoints = (cover.sellingPoints || []).map(p => `<li>${esc(p)}</li>`).join('');
  const tradeOffs     = (cover.tradeOffs || []).map(p => `<li>${esc(p)}</li>`).join('');
  const bundles       = (cover.optionalBundles || [])
    .map(b => `<div class="bundle">${esc(b.label)}<span class="note">${esc(b.note || 'promotional add-on')}</span></div>`)
    .join('');

  return `<div class="sheet">
  <div class="masthead">
    <div class="eyebrow">Insurance Fact Sheet</div>
    <h1>${esc(cover.shortName)}</h1>
    <div class="tagline">${esc(cover.oneLiner || '')}</div>
    <div style="margin-top:10px;">
      <span class="pill ${pillClass}">${esc(cover.category || '')}</span>
      <span class="mono">${esc(cover.key)}</span>
    </div>
  </div>

  <div class="need-callout">
    <div class="label">Who this is for</div>
    <div class="summary"><strong>${esc(cover.need?.label || '')}.</strong> ${esc(cover.need?.summary || '')}</div>
  </div>

  <h2>Key features</h2>
  <ul>${sellingPoints}</ul>

  <h2>Why this vs alternatives</h2>
  <div class="superior">${esc(cover.whySuperiorVsAlternatives || '')}</div>

  <h2>Trade-offs</h2>
  <div class="tradeoffs"><ul>${tradeOffs}</ul></div>

  <h2>Optional bundles</h2>
  <div>${bundles || '<span class="mono">None</span>'}</div>

  <div class="footer">
    Internal training fact sheet · InsureSim · Not a regulatory disclosure document
  </div>
</div>`;
}

export function renderFactSheetPage(coverKey) {
  const cover = COVERS[coverKey];
  if (!cover) {
    return `<!doctype html><meta charset="utf-8"><title>Fact sheet — not found</title>
${baseStyle()}
<div class="sheet"><div class="masthead"><h1>Cover not found</h1>
<p style="margin-top:10px;color:#666;">No cover matches the key "<span class="mono">${esc(coverKey)}</span>". Available covers:</p>
<ul>${COVER_KEYS.map(k => `<li><a href="/api/factsheet/${esc(k)}.html">${esc(COVERS[k].shortName)}</a></li>`).join('')}</ul>
</div></div>`;
  }

  return `<!doctype html><meta charset="utf-8"><title>Fact Sheet — ${esc(cover.shortName)}</title>
${baseStyle()}
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
${renderOneSheet(cover)}`;
}

export function renderAllFactSheetsPage() {
  const sheets = COVER_KEYS.map(k => renderOneSheet(COVERS[k])).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>InsureSim — All Fact Sheets</title>
${baseStyle()}
<button class="print-btn" onclick="window.print()">Print all / Save as PDF</button>
<div class="print-hint">${COVER_KEYS.length} fact sheets · each starts on a new page when printed</div>
${sheets}`;
}

// ─────────────────────────────────────────────────────────────
// Schema validation — ensures every cover has the fields a fact sheet needs.
// Called at module load so bad data fails fast.
// ─────────────────────────────────────────────────────────────
function validateForFactSheets() {
  for (const k of COVER_KEYS) {
    const c = COVERS[k];
    const required = ['shortName', 'oneLiner', 'category', 'sellingPoints', 'whySuperiorVsAlternatives', 'tradeOffs', 'optionalBundles'];
    for (const f of required) {
      if (!c[f]) throw new Error(`factsheet.js: ${k} missing required field "${f}"`);
    }
    if (!c.need?.label || !c.need?.summary) throw new Error(`factsheet.js: ${k} missing need.label or need.summary`);
    if (!Array.isArray(c.sellingPoints) || c.sellingPoints.length < 2) throw new Error(`factsheet.js: ${k} needs ≥2 selling points`);
  }
}
validateForFactSheets();
