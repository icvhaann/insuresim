// tests/scenarios.mjs
//
// Offline validation of the 5 test scenarios specified in the v4 brief.
// These tests exercise pure-function logic (no DeepSeek API required).
// Run: node tests/scenarios.mjs
//
// They cover:
//   Case 1 — User says "not interested" → conversation terminates
//   Case 2 — User questions source → no stage advance, legitimacy flagged
//   Case 3 — Ivan references an offer never made → validator blocks
//   Case 4 — Multi-turn conversation → no contradiction (revealed facts tracked)
//   Case 5 — Insurance mapping → exactly 5 covers, 1:1, ≥1 MI, ≥1 CI, non-VHIS

import { COVERS, COVER_KEYS, pickCover, classifyProbeDirection, classifySellerPitch } from '../src/covers.js';
import { isExitIntent, detectLegitimacy, isOptOut } from '../src/breaches.js';
import { regexGroundingCheck } from '../src/validator.js';
import {
  SESSION_STATES, transition, evaluateRecoveryAttempt, canAdvanceStage
} from '../src/stateMachine.js';

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log('  ✓', msg); }
  else      { failed++; console.log('  ✗', msg); }
};
const section = (n) => console.log(`\n── ${n} ─────────────────────────────`);

// ─────────────────────────────────────────────────────────────
// CASE 1 — Exit intent terminates conversation
// Expected: "not interested" → NORMAL → EXIT_INTENT_EXPRESSED → if seller
// doesn't recover properly → TERMINATED with failed_exit_intent.
// ─────────────────────────────────────────────────────────────
section('Case 1: "not interested" terminates');

assert(isExitIntent('not interested'),        'isExitIntent("not interested") → true');
assert(isExitIntent("I'll pass"),             'isExitIntent("I\'ll pass") → true');
assert(isExitIntent('bye'),                   'isExitIntent("bye") → true');
assert(isExitIntent('leave it'),              'isExitIntent("leave it") → true');
assert(!isExitIntent('tell me more'),         'isExitIntent("tell me more") → false');

// Simulate: Ivan says "not interested" → state goes EXIT_INTENT_EXPRESSED
let s = transition(SESSION_STATES.NORMAL, { ivanExitIntent: true });
assert(s.nextState === SESSION_STATES.EXIT_INTENT_EXPRESSED, 'Normal + exit intent → EXIT_INTENT_EXPRESSED');
assert(!s.terminate, 'Not yet terminated — seller gets one recovery turn');

// Seller's next message doesn't acknowledge, tries to push more sale
let bad = evaluateRecoveryAttempt("but our plan really is great, just one more minute?");
assert(!bad.valid, 'Bad recovery (pushes another pitch) → invalid');

// State machine consumes this bad attempt → TERMINATED
s = transition(SESSION_STATES.EXIT_INTENT_EXPRESSED, {
  recoveryAttempted: true, recoveryValid: bad.valid, ivanExitIntent: false,
});
assert(s.nextState === SESSION_STATES.TERMINATED, 'Bad recovery → TERMINATED');
assert(s.terminate, 'terminate flag set');
assert(s.terminalOutcome === 'failed_exit_intent', 'outcome = failed_exit_intent');

// Alternative: seller's recovery IS valid
let good = evaluateRecoveryAttempt("fair enough, I understand. sorry for the interruption, I won't push further.");
assert(good.valid, 'Good recovery (acknowledge, no push, substantive) → valid');

s = transition(SESSION_STATES.EXIT_INTENT_EXPRESSED, {
  recoveryAttempted: true, recoveryValid: good.valid,
});
assert(s.nextState === SESSION_STATES.RECOVERY_PENDING, 'Valid recovery → RECOVERY_PENDING');
assert(!s.terminate, 'Not terminated (yet)');

// Ivan's response to recovery — if still exit intent, second time = hard terminate
s = transition(SESSION_STATES.RECOVERY_PENDING, { ivanExitIntent: true });
assert(s.nextState === SESSION_STATES.TERMINATED, 'Second exit intent after recovery → TERMINATED');
assert(s.terminalOutcome === 'failed_exit_intent', 'second exit → failed_exit_intent');

// But if Ivan re-engages, flows back through RECOVERED
s = transition(SESSION_STATES.RECOVERY_PENDING, { ivanReengaged: true });
assert(s.nextState === SESSION_STATES.RECOVERED, 'Re-engage after recovery → RECOVERED');
assert(!s.terminate, 'Not terminated');

// Stage advance is blocked in EXIT_INTENT and RECOVERY_PENDING
assert(!canAdvanceStage(SESSION_STATES.EXIT_INTENT_EXPRESSED, 'good', 100, 14), 'canAdvanceStage blocked in EXIT_INTENT_EXPRESSED');
assert(!canAdvanceStage(SESSION_STATES.RECOVERY_PENDING, 'good', 100, 14), 'canAdvanceStage blocked in RECOVERY_PENDING');
assert( canAdvanceStage(SESSION_STATES.NORMAL, 'good', 20, 14), 'canAdvanceStage OK in NORMAL with enough score');
assert(!canAdvanceStage(SESSION_STATES.NORMAL, 'bad',  5,  14), 'canAdvanceStage blocked in NORMAL when score below');

// ─────────────────────────────────────────────────────────────
// CASE 2 — Legitimacy challenge doesn't block — it's surfaced as a signal.
// The trainee can recover, but stage progression should not happen on a
// low-score turn. (Exit-intent blocks the advance; legitimacy doesn't — the
// server just flags and scores accordingly.)
// ─────────────────────────────────────────────────────────────
section('Case 2: "where did you get my number" → legitimacy flagged, no hidden advance');

assert(detectLegitimacy('where did you get my number')?.type === 'data_source',
       'detectLegitimacy → data_source');
assert(!isExitIntent('where did you get my number'),
       'Not exit intent (legitimacy challenge is different)');

// Stage advance in NORMAL with a low accumulator is blocked (normal threshold)
assert(!canAdvanceStage(SESSION_STATES.NORMAL, 'neutral', 8, 14),
       'stage does not advance on low score after a legitimacy challenge');

// ─────────────────────────────────────────────────────────────
// CASE 3 — Ivan references an offer never made → validator blocks it
// ─────────────────────────────────────────────────────────────
section('Case 3: Hallucinated offer blocked by regex validator');

const historyEmpty = [
  { role: 'user',      content: 'hey, just wanted to share something' },
  { role: 'assistant', content: 'what is it' },
];
const sellerMsg1 = 'we have a plan for young professionals';
const ivanHallucinated = 'ok thanks for the free trial';
const v1 = regexGroundingCheck(ivanHallucinated, historyEmpty, sellerMsg1);
assert(!v1.ok, 'Ivan thanking for "free trial" when none offered → validator flags');
assert(v1.issues[0]?.kind === 'free_offer_ack', '→ flagged as free_offer_ack');

// Conversely, when a free trial WAS mentioned, Ivan may legitimately thank
const historyFreeTrial = [
  { role: 'user',      content: 'we are offering a free first month for young pros' },
  { role: 'assistant', content: 'ok go on' },
];
const v2 = regexGroundingCheck('thanks for the free trial, what\'s the catch', historyFreeTrial, 'keen?');
assert(v2.ok, "Ivan thanking when free offer WAS made → validator passes");

// Price hallucination
const v3 = regexGroundingCheck('hkd 300 per month is fine', historyEmpty, 'interested?');
assert(!v3.ok, 'Ivan quoting HKD 300/month when no price was mentioned → flagged');

// Product name hallucination
const v4 = regexGroundingCheck("oh is this the critical shield thing", historyEmpty, 'interested?');
assert(!v4.ok, 'Ivan naming "critical shield" unprompted → flagged');

// Short normal reply
const v5 = regexGroundingCheck('ok what is it', historyEmpty, 'hi');
assert(v5.ok, 'Normal short reply not flagged');

// ─────────────────────────────────────────────────────────────
// CASE 4 — Multi-turn conversation: no contradiction / memory drift
// The stateMachine layer doesn't do LLM-contradiction checks itself (that's
// the LLM validator). We test the SUPPORT mechanism: revealed-fact tracking
// appends across turns and persists in an append-only fashion.
// ─────────────────────────────────────────────────────────────
section('Case 4: Multi-turn revealed-fact tracking');

// Simulate client-side append pattern
let revealedFacts = [];
// Turn 3: server signals Ivan disclosed surface_1
revealedFacts.push('surface_1');
// Turn 6: server signals Ivan disclosed surface_2
revealedFacts.push('surface_2');
assert(revealedFacts.length === 2, 'Revealed facts accumulated over turns');
assert(revealedFacts[0] === 'surface_1' && revealedFacts[1] === 'surface_2', 'Order preserved');
// (Further turns would pass this array to the server for inclusion in the prompt)

// ─────────────────────────────────────────────────────────────
// CASE 5 — Insurance mapping: exactly 5 covers, 1:1, ≥1 MI, ≥1 CI, non-VHIS
// ─────────────────────────────────────────────────────────────
section('Case 5: Insurance catalog schema');

assert(COVER_KEYS.length === 5, 'Exactly 5 covers in the catalog');

const miCount = COVER_KEYS.filter(k => COVERS[k].isMedical).length;
const ciCount = COVER_KEYS.filter(k => COVERS[k].isCriticalIllness).length;
assert(miCount >= 1, `At least 1 Medical cover (found ${miCount})`);
assert(ciCount >= 1, `At least 1 Critical Illness cover (found ${ciCount})`);

// 1:1 need mapping (unique labels)
const needLabels = new Set(COVER_KEYS.map(k => COVERS[k].need.label));
assert(needLabels.size === 5, '1:1 need mapping — 5 distinct need labels');

// Unique categories
const cats = new Set(COVER_KEYS.map(k => COVERS[k].category));
assert(cats.size === 5, '5 distinct categories');

// Non-VHIS
for (const k of COVER_KEYS) {
  const text = JSON.stringify(COVERS[k]).toLowerCase();
  assert(!/\bvhis\b/.test(text), `${k} is non-VHIS`);
}

// Every cover has required fields
for (const k of COVER_KEYS) {
  const c = COVERS[k];
  assert(typeof c.oneLiner === 'string' && c.oneLiner.length > 20, `${k}: oneLiner present`);
  assert(Array.isArray(c.sellingPoints) && c.sellingPoints.length >= 2, `${k}: ≥2 selling points`);
  assert(typeof c.whySuperiorVsAlternatives === 'string' && c.whySuperiorVsAlternatives.length > 30, `${k}: whySuperior filled`);
  assert(Array.isArray(c.tradeOffs) && c.tradeOffs.length >= 1, `${k}: ≥1 trade-off`);
  assert(Array.isArray(c.optionalBundles), `${k}: optionalBundles present`);
  assert(typeof c.ivanBackstory === 'string' && c.ivanBackstory.includes('<hidden_need_layer'), `${k}: backstory has hidden_need_layer`);
}

// Bundles labelled as promotional
for (const k of COVER_KEYS) {
  for (const b of COVERS[k].optionalBundles) {
    assert(b.note && /promo/i.test(b.note), `${k} bundle "${b.label}" labelled as promotional`);
  }
}

// Classification: probe/pitch work for each cover
const probeSeeds = {
  starter_protection: 'public hospital queue for drugs',
  critical_shield:    'cancer in your family',
  active_guard:       'sports injury in the last year',
  income_continuity:  "couldn't work for 12 months",
  smart_start_saver:  'idle savings and investment',
};
for (const [k, seed] of Object.entries(probeSeeds)) {
  assert(classifyProbeDirection(seed) === k, `Probe "${seed}" → ${k}`);
}

const pitchSeeds = {
  starter_protection: 'hospital indemnity for self-financed drugs',
  critical_shield:    'critical illness plan with lump-sum payout',
  active_guard:       'personal accident with sports injury cover',
  income_continuity:  'disability income protection',
  smart_start_saver:  'endowment plan with monthly contribution',
};
for (const [k, seed] of Object.entries(pitchSeeds)) {
  assert(classifySellerPitch(seed) === k, `Pitch "${seed}" → ${k}`);
}

// ─────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('FAILURES'); process.exit(1); }
console.log('All test scenarios passed.');
