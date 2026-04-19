// src/insuranceNeeds.js
// Ivan's hidden insurance-need layer. Randomly assigned at session start (50/50).
// The seller must uncover which need applies and ultimately pitch the correct product
// TYPE. Closing on the wrong type when Ivan agrees = mis-sell failure, revealed at debrief.
//
// This layer is stacked ON TOP of the archetype overlay (Burned / Default / Slammed /
// Warm-but-wary). Archetype controls engagement style; need controls product fit.

export const INSURANCE_NEEDS = {
  medical: {
    key: 'medical',
    shortName: 'Medical / Hospital Indemnity',
    oneLiner:
      "Ivan's real need is medical cover — his company's group plan is thin, he just had a HKD 4.8k out-of-pocket sports-injury bill, and his friend's Niseko incident keeps replaying in his head.",
    // Injected into the system prompt after BASE_IVAN and the archetype overlay.
    backstoryOverlay: `
<hidden_need_layer kind="medical_indemnity">
In addition to everything in <inner_life>, the following facts are sitting in your head today. They are the REAL reason any unsolicited insurance message might actually land with you — if (and only if) the seller probes close enough to earn them.

- Three weeks ago you rolled your ankle playing basketball at the SYP indoor sports complex. You limped for a week. You went to a private clinic rather than the awkward company GP. X-ray + consult + a physio referral cost HKD 4,800 out of pocket. Your group medical reimbursed HKD 500. This genuinely rattled you.
- Your mum had a gallbladder surgery last month. Private-room top-up would have been roughly HKD 80k more than semi-private. The family chose semi-private. You felt quietly guilty.
- The friend's Niseko skiing accident already mentioned in <inner_life> is your constant reference point — his group medical refused most of the bill because "off-duty sports injury".
- Your actual unspoken question: "If I break a leg skiing next January, or worse, could I afford a HK private hospital without wiping out my savings?"
- You do NOT have any personal outpatient, hospital-cash, or private-hospital-indemnity plan. Just your company's thin group medical.

<discovery_gate>
Do NOT volunteer these details unsolicited. Only release them when the seller has earned the right by probing the adjacent topic area:
- The ankle incident → shareable once the seller has asked about sports-related injuries, weekend activity, or recent health costs.
- The HKD 4,800 figure → shareable only if the seller has directly asked about an out-of-pocket cost, a recent clinic visit, or "have you ever been surprised by a medical bill".
- Your mum's surgery → shareable only after real rapport (trust ≥ 60) and when hospital-vs-public-ward context is directly discussed.
- The Niseko friend story → already gated in <inner_life>. Same rules: genuine rapport AND direct relevance.
</discovery_gate>

<wrong_pitch_reaction>
If the seller starts pitching critical illness / cancer cover / lump sum on diagnosis / income replacement / "what if you got a major illness" as the MAIN product:
- Do not accept the pitch.
- React politely but coolly. Sample tones (pick one, do not quote verbatim): "hmm ngl that's not really what's on my mind. more like if i hurt myself tomorrow, not cancer in 10 years la.", "tbh i'm less worried about the big scary stuff than the stuff that actually happens every weekend lol", "ok but my company already covers like… heart attack and stuff? i think? it's the smaller injury bills that get me."
- If they persist or try to close this wrong product: sharper pushback, and you move toward disengaging.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches hospital indemnity / outpatient cover / daily hospital cash / private-room coverage / sports-injury rider / top-up to group medical:
- You feel a small internal click — "ok that actually sounds like what i've been thinking about."
- You engage more — ask about specifics (outpatient cap, private room coverage, sports inclusions, monthly cost).
- You are now in a position to ask for the link / agent handoff — but only after the seller has given you enough specifics that you feel like you understand what you're buying.
</correct_pitch_reaction>
</hidden_need_layer>`,
    // Topic areas that count as "probing the right direction" in Stage 2.
    discoveryAreas: [
      'recent sports injury or ankle/knee incident',
      'out-of-pocket clinic / doctor costs',
      'group medical sublimits and exclusions',
      'outpatient vs inpatient coverage',
      'private vs public hospital experience',
      'sports-related exclusions',
      'how a weekend injury would actually be paid for',
      'hospital cash / daily benefit',
    ],
    // Patterns in SELLER messages indicating they're pitching MI (correct for this need).
    correctPitchPatterns: [
      /\bhospital\s*(indemnity|cash|income|benefit)/i,
      /\boutpatient\s*(cover|benefit|plan|rider|cap|limit)/i,
      /\bprivate\s*(room|ward|hospital)\s*(cover|coverage|plan)?/i,
      /\bsports?\s*(injury)?\s*(rider|cover|add-?on)/i,
      /\btop.?up\s*(to|for|on)?\s*(your)?\s*(group|company)/i,
      /\bdaily\s*(hospital\s*)?cash/i,
      /\bhospitalisation\s*(plan|cover|indemnity)/i,
      /\b(personal\s*)?accident\s*(plan|cover|rider)\b/i,
      /\bmedical\s*(indemnity|top.?up|supplement)/i,
      /\bvhis\b/i,
      /\breimburse(ment)?\s*of\s*(hospital|medical|outpatient)/i,
    ],
    // Patterns in SELLER messages indicating they're pitching CI (WRONG for this need).
    wrongPitchPatterns: [
      /\bcritical\s*illness\b/i,
      /\bearly\s*ci\b|\bearly\s*stage\s*critical/i,
      /\blump.?sum\s*(on|at|upon|for|payout|diagnos)/i,
      /\bcancer\s*(cover|insurance|plan|protection|rider)\b/i,
      /\bincome\s*(replacement|protection|continuation)/i,
      /\bheart\s*(attack|disease)\s*cover/i,
      /\b(ci|cii)\s*(plan|policy|cover|insurance)\b/i,
      /\bdreaded\s*disease/i,
    ],
  },

  critical_illness: {
    key: 'critical_illness',
    shortName: 'Critical Illness / Lump Sum',
    oneLiner:
      "Ivan's real need is critical illness cover — his uncle (52) was diagnosed with stage-2 colorectal cancer two months ago, his dad keeps making pointed comments, and his own borderline cholesterol result has been bothering him.",
    backstoryOverlay: `
<hidden_need_layer kind="critical_illness">
In addition to everything in <inner_life>, the following facts are sitting in your head today. They are the REAL reason any unsolicited insurance message might actually land with you — if (and only if) the seller probes close enough to earn them.

- Two months ago your uncle (your dad's younger brother, age 52) was diagnosed with stage-2 colorectal cancer. He's in chemo. It's been heavy at family dinners. Your dad has been visibly shaken and has started making pointed comments to you: "you young people think you're invincible", "look at your uncle". You brush him off to his face but the comments have stuck.
- Your paternal grandfather died of a heart attack at 58. Your dad is 56 now. Dad does routine checkups. You do not.
- Six weeks ago you went for the free annual checkup your company offers. Cholesterol came back borderline elevated. Doctor said "watch it". You were surprised — you're 25 and reasonably active. It's been bothering you quietly.
- You are the only son. Your younger sister is in her final year of uni. If you couldn't work for 12+ months because of a serious diagnosis, your parents have no meaningful financial safety net — dad's small business income is modest.
- Your actual unspoken question: "If I got something serious at 30, would mum and dad be OK? I'd need a lump sum for treatment AND living costs while not working. Group medical doesn't touch that."
- You already think your company's group medical is fine for day-to-day stuff. It's the BIG thing you don't have any cushion against.

<discovery_gate>
Do NOT volunteer these details unsolicited. Only release them when the seller has earned the right by probing the adjacent topic area:
- The cholesterol result → shareable once the seller has asked about recent checkups, lifestyle risks, or long-term health.
- Your uncle's cancer → personal. Only share after genuine rapport (trust ≥ 55) and only once the conversation is clearly about serious-illness scenarios or family health.
- Your grandfather's heart attack / dad's heart history → deeper still. Only share if the conversation is explicitly about family medical history.
- The "what if I couldn't work" / responsibility-to-parents frame → shareable once the seller has raised long-illness or income-protection scenarios.
</discovery_gate>

<wrong_pitch_reaction>
If the seller starts pitching hospital indemnity / outpatient cover / daily hospital cash / sports-injury rider / private-room top-ups as the MAIN product:
- Do not accept the pitch.
- React politely but cool. Sample tones (pick one, do not quote verbatim): "tbh my company plan's ok for day-to-day stuff la. it's more the big-scary-illness thing that's been on my mind.", "hmm outpatient etc is not really what i'm worried about. something bigger lor.", "ngl i don't really care about small hospital bills. it's the 'what if it's serious' question that sticks."
- If they persist or try to close this wrong product: sharper pushback, and you move toward disengaging.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches critical illness / early-stage CI / cancer cover with lump-sum payout / income protection on serious diagnosis / "something that pays out a lump sum if something major happens":
- You feel a small internal click — "ok ngl that's actually been on my mind."
- You engage more — ask about specifics (what illnesses are covered, early-stage definition, payout size, premium at your age).
- You are now in a position to ask for the link / agent handoff — but only after the seller has given you enough specifics that you feel like you understand what you're buying.
</correct_pitch_reaction>
</hidden_need_layer>`,
    discoveryAreas: [
      'family health history (parents, grandparents)',
      'recent checkups and health results',
      'long-term / major illness scenarios',
      'income gap during an extended illness',
      'responsibility to dependants / parents',
      'cancer, heart disease, stroke awareness',
      '"what if you could not work for a year"',
      'lump-sum vs ongoing reimbursement',
    ],
    correctPitchPatterns: [
      /\bcritical\s*illness\b/i,
      /\bearly\s*ci\b|\bearly\s*stage\s*critical/i,
      /\blump.?sum\s*(on|at|upon|for|payout|diagnos)/i,
      /\bcancer\s*(cover|insurance|plan|protection|rider)\b/i,
      /\bincome\s*(replacement|protection|continuation)/i,
      /\bheart\s*(attack|disease)\s*(cover|protection|plan)/i,
      /\b(ci|cii)\s*(plan|policy|cover)\b/i,
      /\bmulti.?(claim|pay)\s*ci/i,
      /\bdreaded\s*disease/i,
      /\bmajor\s*illness\s*(cover|plan)/i,
      /\bwhole.?life\s*ci/i,
    ],
    wrongPitchPatterns: [
      /\bhospital\s*(indemnity|cash|income|benefit)(?!.{0,40}(lump|critical|illness))/i,
      /\boutpatient\s*(cover|benefit|plan|rider|cap|limit)/i,
      /\bprivate\s*(room|ward)\s*(cover|coverage|plan)?/i,
      /\bsports?\s*(injury)?\s*(rider|cover|add-?on)/i,
      /\btop.?up\s*(to|for|on)?\s*(your)?\s*(group|company)/i,
      /\bdaily\s*(hospital\s*)?cash/i,
      /\bhospitalisation\s*(plan|cover|indemnity)/i,
      /\b(personal\s*)?accident\s*(plan|rider)(?!.{0,30}(critical|illness))/i,
      /\bvhis\b/i,
    ],
  },
};

export function pickInsuranceNeed() {
  return Math.random() < 0.5 ? 'medical' : 'critical_illness';
}

// Classify a single seller message by which insurance product type it pitches.
// Returns: 'medical' | 'critical_illness' | 'both' | 'generic' | null
//   'medical'          → clearly an MI product pitch
//   'critical_illness' → clearly a CI product pitch
//   'both'             → mentions both (seller exploring)
//   'generic'          → says "insurance/policy/coverage" without a specific product type
//   null               → no insurance language at all
export function classifySellerPitch(msg) {
  if (!msg) return null;
  const mi = INSURANCE_NEEDS.medical.correctPitchPatterns;
  const ci = INSURANCE_NEEDS.critical_illness.correctPitchPatterns;
  const hitsMI = mi.some(p => p.test(msg));
  const hitsCI = ci.some(p => p.test(msg));
  if (hitsMI && hitsCI) return 'both';
  if (hitsMI) return 'medical';
  if (hitsCI) return 'critical_illness';
  const GENERIC = /\b(insurance|insure|insurer|policy|policies|premium|coverage|covered|protection\s*plan)\b/i;
  if (GENERIC.test(msg)) return 'generic';
  return null;
}

// Classify the seller's probing direction in a message.
// Returns: 'medical' | 'critical_illness' | 'both' | 'neutral'
// Used by preScoreMessage to reward alignment with Ivan's actual need.
export function classifyProbeDirection(msg) {
  const m = (msg || '').toLowerCase();
  const miProbes = [
    'group medical', 'company medical', 'company insurance', 'company plan',
    'outpatient', 'hospital bill', 'hospital cost', 'clinic', 'doctor visit', 'physio',
    'sports injury', 'sprain', 'x-ray', 'xray',
    'private hospital', 'public hospital', 'queen mary', 'prince of wales', 'qmh',
    'weekend injury', 'ankle', 'knee', 'shoulder', 'broke a',
    'sublimit', 'out of pocket', 'out-of-pocket', 'excess', 'deductible',
    'hospital cash', 'private room', 'daily cash', 'indemnity',
    'accident', 'minor injury', 'gp visit',
  ];
  const ciProbes = [
    'family history', 'family health', 'your parents', 'your dad', 'your mum', 'your mom',
    "parents' health", "parents health", 'grandfather', 'grandpa', 'grandmother', 'grandma',
    'cancer', 'heart disease', 'heart attack', 'stroke', 'diabetes',
    'long-term illness', 'long term illness', 'serious illness', 'major illness',
    'unable to work', "can't work", 'cannot work', 'out of work for',
    'critical', 'lump sum', 'income gap', 'replacement income',
    'cholesterol', 'checkup', 'check-up', 'diagnosis', 'medical history',
    'dependants', 'dependents', 'provide for', 'support your family', 'support your parents',
    'what if you got', 'if something serious',
  ];
  const miHits = miProbes.filter(p => m.includes(p)).length;
  const ciHits = ciProbes.filter(p => m.includes(p)).length;
  if (miHits === 0 && ciHits === 0) return 'neutral';
  if (miHits > 0 && ciHits > 0 && Math.abs(miHits - ciHits) <= 1) return 'both';
  return miHits > ciHits ? 'medical' : 'critical_illness';
}

// Does this seller message attempt to close / ask for commitment?
// Distinct from Ivan's close-signal (that's in breaches.js USER_INTENT_CLOSE_PATTERN).
const SELLER_CLOSE_PATTERN =
  /\b(shall\s*i|should\s*i|want\s*me\s*to|let\s*me)\s*(send|share|drop|forward|connect|hand|pass)|\b(send|sharing|sharing\s*you)\s*the\s*(link|details|policy|brief|quote|proposal)|\b(connect|hand(ing)?\s*off|refer)\s*you\s*(with|to)\s*(an?\s*)?(agent|advisor|specialist|consultant|licensed)|\b(ready|happy)\s*to\s*(proceed|go\s*ahead|sign|start)|\b(apply|sign\s*up)\s*now|\bproceed\s*with\s*(the|this)/i;

export function isSellerCloseAttempt(msg) {
  return SELLER_CLOSE_PATTERN.test(msg || '');
}
