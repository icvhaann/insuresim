// src/covers.js
//
// The 5-cover catalog. Each session randomly assigns ONE cover as Ivan's true fit
// (independent of archetype). The trainee's job is to probe the right area, then
// pitch the matching product type. Wrong specific pitch → soft-rejected. Closing
// on the wrong cover → failed_missold.
//
// All 5 covers are non-VHIS. Schema enforced at module load (see validateCatalog
// at bottom).
//
// The `Starter Protection` cover is adapted directly from the reference PPT.
// The other four are constructed to cover distinct, non-overlapping concern areas
// so the discovery puzzle has clean signal separation.

export const COVERS = {
  // ─────────────────────────────────────────────────────────────
  // 1. STARTER PROTECTION — patches public-healthcare gaps
  //    Source: Starter_Protection.pptm (PPT reference)
  // ─────────────────────────────────────────────────────────────
  starter_protection: {
    key: 'starter_protection',
    shortName: 'Starter Protection',
    category: 'medical_hospital_indemnity',
    isMedical: true,
    isCriticalIllness: false,
    oneLiner:
      "Low-cost shield that patches the biggest holes in Hong Kong public healthcare: self-financed drugs, diagnostic wait times, and day-surgery cash.",
    need: {
      label: 'public-healthcare-gap anxiety',
      summary:
        "Ivan's real concern is what happens inside the HK public hospital system — self-financed drugs, long diagnostic waits, and the HKD-80k jump-queue premium to private that his family recently faced.",
    },
    sellingPoints: [
      "Covers self-financed drugs and items inside HK public hospitals (the biggest out-of-pocket line in serious care)",
      "Covers diagnostic imaging at private providers to skip public-queue wait times",
      "Cash benefit for hospitalization or day surgery, usable globally",
      "Up to HKD 500,000 per disability per year",
    ],
    whySuperiorVsAlternatives:
      "Unlike full private-hospital plans, you pay a fraction of the premium and still fix the two gaps that actually hurt young people in public care — drug bills and imaging delays. Unlike company group medical, it keeps paying you even between jobs.",
    tradeOffs: [
      "No private-hospital coverage in HK",
      "No cross-border / mainland hospital benefits",
      "Lower annual ceiling than full-tier plans",
    ],
    optionalBundles: [
      { label: 'Telehealth GP subscription', note: 'promotional add-on' },
      { label: 'Annual wellness checkup voucher', note: 'promotional add-on' },
    ],
    ivanBackstory: `
<hidden_need_layer cover="starter_protection" category="medical / public-healthcare gap">
In addition to everything in <inner_life>, the following facts are on Ivan's mind today. They are the REAL reason an insurance message might land — but they are PRIVATE until the seller earns them through <disclosure_rules>.

BACKSTORY ITEMS (release exactly ONE per turn when disclosure is permitted):
SURFACE LEVEL (releasable first):
- [surface_1] Mum had gallbladder surgery last month in a HK public hospital. Two-week wait for a slot. She was in a 6-bed ward. Semi-private top-up would have cost ~HKD 80k; the family didn't do it. You felt quietly guilty.
- [surface_2] A colleague in your team was hospitalised for a week with dengue earlier this year. Spent HKD 18,000 on self-financed drugs inside the public system — not reimbursed by anyone. Your mum mentioned it at a family dinner.

DEEPER LEVEL (only if trust ≥ 60 AND discovery_level ≥ 3):
- [deep_1] You googled "how much is a private room at Queen Mary" last weekend out of mild curiosity. The answer rattled you.
- [deep_2] Your actual unspoken question: "If I needed something serious tomorrow, could I afford to jump the queue, or would I just sit in public like mum did?"
- [deep_3] You know your company group medical is very thin on the drug-bill side — the HR brief literally says "self-financed items not covered".

<wrong_pitch_reaction>
If the seller pitches critical illness / lump-sum on diagnosis / disability income / savings products / accident+sports riders as the MAIN product:
- Politely decline to engage with it as the main thing.
- Sample tones (do not quote verbatim — pick one and adapt): "hmm ngl that's not really what's on my mind. more about normal hospital stuff la.", "tbh it's more the 'what if I actually end up in hospital next year' side", "i'm less worried about big scary stuff than just… regular hospital bills actually".
- If they persist or try to close: sharper pushback. Move toward disengaging.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches hospital indemnity / drug-bill cover / self-financed items / diagnostic imaging / public-hospital top-up / day-surgery cash:
- Internal click: "ok that actually matches what's been bugging me."
- Ask about specifics (what drugs are covered, imaging cap, does it include Queen Mary, what exactly counts as self-financed).
- Only after you've heard real specifics: you MAY ask for the link or agent handoff.
</correct_pitch_reaction>
</hidden_need_layer>`,
    probeVocab: [
      'public hospital', 'queen mary', 'prince of wales', 'qmh', 'queue', 'waiting list', 'wait time',
      'self-financed', 'self financed', 'drug bill', 'medication cost', 'drug cost', 'medicine cost',
      'diagnostic', 'imaging', 'mri', 'ct scan', 'x-ray wait', 'xray wait',
      'hospital bill', 'out of pocket', 'out-of-pocket',
      'group medical gap', 'hr brief', 'company plan gap', 'company medical gap',
      'jump queue', 'semi-private', 'semi private', 'private top-up', 'private top up', 'private room',
    ],
    correctPitchRegex: [
      /\bhospital\s*(indemnity|cash|income|benefit)/i,
      /\bself.?financed\s*(drug|item|medication)/i,
      /\bdiagnostic\s*(imaging|scan|mri|ct)/i,
      /\bpublic\s*(hospital|ward)\s*(top.?up|supplement|gap)/i,
      /\bday\s*surgery\s*(cash|benefit|cover)/i,
      /\bdrug\s*(cover|bill\s*cover|expense\s*cover)/i,
      /\bstarter\s*protection\b/i,
      /\bpatch(es|ing)?\s*(public|gap)/i,
    ],
    // Signal phrase fragments the trainee could say that — across ALL 5 covers — count
    // as pitching a SPECIFIC product type (used for pitch-classification triage).
  },

  // ─────────────────────────────────────────────────────────────
  // 2. CRITICAL SHIELD — lump-sum on serious diagnosis
  // ─────────────────────────────────────────────────────────────
  critical_shield: {
    key: 'critical_shield',
    shortName: 'Critical Shield',
    category: 'critical_illness',
    isMedical: false,
    isCriticalIllness: true,
    oneLiner:
      "Lump-sum payout on diagnosis of cancer, heart attack, stroke and other defined critical illnesses — covers treatment AND living costs while not working.",
    need: {
      label: 'critical-illness financial exposure',
      summary:
        "Ivan's real concern is family CI history (uncle's cancer, grandpa's heart attack) combined with a recent borderline cholesterol result. Group medical pays hospital bills; it does NOT pay the rent while he can't work.",
    },
    sellingPoints: [
      "Lump-sum payout on diagnosis — use it however you need (treatment, living costs, a year off work)",
      "Covers cancer, heart attack, stroke, and 50+ other defined conditions",
      "Early-stage CI benefit pays at early diagnosis (not just late stage)",
      "Multi-claim option — coverage doesn't end after first payout",
    ],
    whySuperiorVsAlternatives:
      "Group medical reimburses hospital bills. It does NOT pay you when you can't work for 12 months. Hospital indemnity covers the room, not the rent. Only a lump-sum product closes the income-and-dignity gap during an extended serious illness.",
    tradeOffs: [
      "No coverage for the small stuff — outpatient, GP, minor injuries",
      "Payout is a fixed lump sum, not open-ended reimbursement",
      "Premium rises meaningfully above age 35",
    ],
    optionalBundles: [
      { label: 'Second-opinion consultation subscription', note: 'promotional add-on' },
      { label: 'Oncology concierge service', note: 'promotional add-on' },
    ],
    ivanBackstory: `
<hidden_need_layer cover="critical_shield" category="critical illness / lump-sum">
In addition to everything in <inner_life>, the following facts are on Ivan's mind today. They are the REAL reason an insurance message might land — but they are PRIVATE until the seller earns them through <disclosure_rules>.

BACKSTORY ITEMS (release exactly ONE per turn when disclosure is permitted):
SURFACE LEVEL (releasable first):
- [surface_1] Your uncle (dad's younger brother, 52) was diagnosed with stage-2 colorectal cancer two months ago. He's in chemo. Family dinners have been heavy.
- [surface_2] You went for your company's free annual checkup six weeks ago. Cholesterol came back borderline elevated. Doctor said "watch it". You were surprised — you're 25 and reasonably active. Has been sitting in your head since.

DEEPER LEVEL (only if trust ≥ 60 AND discovery_level ≥ 3):
- [deep_1] Your paternal grandfather died of a heart attack at 58. Your dad is 56 now. Dad does routine checkups. You do not.
- [deep_2] You are the only son. Your younger sister is in her final year of uni. If you couldn't work for 12+ months, your parents have no meaningful safety net — dad's small business income is modest.
- [deep_3] Your actual unspoken question: "If I got something serious at 30, would mum and dad be OK? I'd need a lump sum for treatment AND for living costs while I wasn't working. Group medical doesn't touch that."

<wrong_pitch_reaction>
If the seller pitches hospital indemnity / outpatient cover / sports-injury rider / savings product / disability-income-only as the MAIN product:
- Politely decline to engage with it as the main thing.
- Sample tones (adapt, do not quote): "tbh my company plan's ok for day-to-day stuff. it's more the big-scary-illness thing that's been on my mind.", "ngl outpatient isn't what i'm worried about. something bigger lor.", "it's the 'what if it's serious' question that sticks with me, not small bills".
- If they persist or try to close: sharper pushback. Move toward disengaging.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches critical illness / early-stage CI / cancer cover with lump-sum / multi-claim CI / "pays out on diagnosis":
- Internal click: "ok ngl that's actually been on my mind."
- Ask about specifics (what illnesses covered, early-stage definition, payout size, premium at your age, multi-claim).
- Only after you've heard real specifics: you MAY ask for the link or agent handoff.
</correct_pitch_reaction>
</hidden_need_layer>`,
    probeVocab: [
      'family history', 'family health', 'your parents', 'your dad', 'your mum', 'your mom',
      "parents' health", 'grandfather', 'grandpa', 'grandmother', 'grandma',
      'cancer', 'heart disease', 'heart attack', 'stroke', 'diabetes',
      'long-term illness', 'long term illness', 'serious illness', 'major illness',
      'critical illness', 'critical', 'lump sum', 'lump-sum',
      'cholesterol', 'checkup', 'check-up', 'medical history', 'diagnos',
      'what if you got', 'if something serious', 'dreaded disease',
    ],
    correctPitchRegex: [
      /\bcritical\s*illness\b/i,
      /\bearly\s*ci\b|\bearly.?stage\s*critical/i,
      /\blump.?sum\s*(on|at|upon|for|payout|diagnos)/i,
      /\bcancer\s*(cover|insurance|plan|protection|rider)\b/i,
      /\bheart\s*(attack|disease)\s*(cover|protection|plan)/i,
      /\bmulti.?(claim|pay)\s*ci/i,
      /\bdreaded\s*disease/i,
      /\bmajor\s*illness\s*(cover|plan)/i,
      /\bci\s*(plan|policy|cover)\b/i,
      /\bcritical\s*shield\b/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 3. ACTIVE GUARD — personal accident + sports injury
  // ─────────────────────────────────────────────────────────────
  active_guard: {
    key: 'active_guard',
    shortName: 'Active Guard',
    category: 'personal_accident_sports',
    isMedical: true,
    isCriticalIllness: false,
    oneLiner:
      "Personal-accident and sports-injury cover — pays out for fractures, dislocations, ligament tears, clinic visits and physio after weekend injuries that group medical typically excludes.",
    need: {
      label: 'recurring weekend-sports injury costs',
      summary:
        "Ivan's real concern is the pattern of small-but-not-small injuries from an active lifestyle — rolled ankles, tweaked shoulders, surprise clinic bills that group medical barely touches.",
    },
    sellingPoints: [
      "Fracture and dislocation cash benefits — paid on diagnosis, not on filing a hospital bill",
      "Physio sessions covered (group medical almost never covers this)",
      "Covers amateur contact sports, running, cycling, climbing, skiing — no off-duty exclusion",
      "Clinic and GP visit reimbursement with no sports-carve-out",
    ],
    whySuperiorVsAlternatives:
      "Group medical treats amateur sports injuries as 'off-duty' and declines 80%+ of the bill. Hospital indemnity only kicks in if you're admitted. This cover pays for the kind of injury you actually have — walking out of a clinic on a crutch with a HKD 5k bill.",
    tradeOffs: [
      "No coverage for illness, only accidents and sports-related injuries",
      "Competitive / professional sports often excluded",
      "Cash benefits are capped per incident",
    ],
    optionalBundles: [
      { label: 'Physio clinic partner discount (quarterly)', note: 'promotional add-on' },
      { label: 'Active-lifestyle fitness app subscription', note: 'promotional add-on' },
    ],
    ivanBackstory: `
<hidden_need_layer cover="active_guard" category="personal accident / sports">
In addition to everything in <inner_life>, the following facts are on Ivan's mind today. They are the REAL reason an insurance message might land — but they are PRIVATE until the seller earns them through <disclosure_rules>.

BACKSTORY ITEMS (release exactly ONE per turn when disclosure is permitted):
SURFACE LEVEL (releasable first):
- [surface_1] Three weeks ago you rolled your ankle playing basketball. Limped for a week. Private clinic + x-ray + physio referral ran HKD 4,800 out of pocket. Group medical paid you back HKD 500.
- [surface_2] You've sprained both ankles at least once each in the last year. You used to shrug it off; the latest one genuinely made you pause.

DEEPER LEVEL (only if trust ≥ 60 AND discovery_level ≥ 3):
- [deep_1] Your group medical policy explicitly calls out "off-duty sports injuries" as excluded. You only noticed this after the ankle bill.
- [deep_2] You're playing basketball Mon/Wed evenings; you're probably not stopping. You've quietly calculated that if you do this for a year you'll have another 1–2 bills like the HKD 4,800.
- [deep_3] Your actual unspoken question: "I'm not going to stop playing. Can I just pay a flat monthly amount to stop eating these surprise bills?"

<wrong_pitch_reaction>
If the seller pitches critical illness / hospital indemnity-without-sports-cover / pure life / savings / disability income as the MAIN product:
- Politely decline. Sample tones: "hmm that's not really it la. i keep eating small injury bills, that's what's bugging me.", "the big scary stuff is fine, it's the weekly weekend bumps that add up lol", "ngl i need something that covers the ankle i'll probably roll next month, not cancer in 20 years".
- If they persist or try to close: sharper pushback.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches personal accident / sports injury rider / physio cover / fracture cash / active-lifestyle plan / amateur-sports cover:
- Internal click: "ok this is actually what i've been looking at."
- Ask about specifics (which sports, basketball included, is physio capped, how many claims per year, what qualifies as an accident).
- Only after real specifics: you MAY ask for the link or agent handoff.
</correct_pitch_reaction>
</hidden_need_layer>`,
    probeVocab: [
      'sports injury', 'sports injuries', 'sports-related', 'injur', 'sprain', 'rolled ankle',
      'ankle', 'knee', 'shoulder', 'ligament', 'fracture', 'broken', 'broke a',
      'basketball', 'running', 'cycling', 'climbing', 'gym',
      'physio', 'physiotherapy', 'clinic', 'doctor visit', 'gp visit',
      'off-duty', 'off duty', 'exclud', 'exclusion', 'group medical exclusion',
      'accident', 'minor injur', 'weekend injur',
    ],
    correctPitchRegex: [
      /\b(personal\s*)?accident\s*(plan|cover|rider|insurance|protection)\b/i,
      /\bsports?\s*(injury)?\s*(rider|cover|add-?on|protection|plan)/i,
      /\bactive.?(life|lifestyle)\s*(plan|cover)/i,
      /\bphysio(therapy)?\s*(cover|benefit|reimbursement)/i,
      /\bfracture\s*(cash|benefit|cover)/i,
      /\bamateur.?sports\s*cover/i,
      /\bactive\s*guard\b/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 4. INCOME CONTINUITY — disability income / wage replacement
  // ─────────────────────────────────────────────────────────────
  income_continuity: {
    key: 'income_continuity',
    shortName: 'Income Continuity',
    category: 'disability_income',
    isMedical: false,
    isCriticalIllness: false,
    oneLiner:
      "Pays a monthly income if you can't work due to serious illness or injury — replaces wages up to 70%, bridging the gap while you recover.",
    need: {
      label: 'income-loss / dependants exposure',
      summary:
        "Ivan's real concern is what happens to the monthly transfer to his mum and the rent on his share of the SYP flat if he's out of work for 6–12 months. Group medical covers medical bills; it does not pay the mortgage.",
    },
    sellingPoints: [
      "Monthly payout up to 70% of salary while you cannot work",
      "Can pay for up to 24 months per incident, or to retirement age on severe disability",
      "Covers both accidents AND illness-driven inability to work",
      "Short waiting period (as low as 4 weeks) means bills don't stack up",
    ],
    whySuperiorVsAlternatives:
      "Group medical pays the hospital. Critical-illness pays a one-time lump sum. Neither of them keeps rent paid for 9 months while you recover. This is the only product that covers the thing that actually ruins a young person financially — wages stopping while bills don't.",
    tradeOffs: [
      "Doesn't pay anything for short-duration illness (typically <4 weeks)",
      "Payout is a % of salary, not a fixed lump sum",
      "Policy definitions of 'disability' matter — read carefully",
    ],
    optionalBundles: [
      { label: 'Career-coaching support subscription', note: 'promotional add-on' },
      { label: 'Mental-health helpline access', note: 'promotional add-on' },
    ],
    ivanBackstory: `
<hidden_need_layer cover="income_continuity" category="disability income / wage replacement">
In addition to everything in <inner_life>, the following facts are on Ivan's mind today. They are the REAL reason an insurance message might land — but they are PRIVATE until the seller earns them through <disclosure_rules>.

BACKSTORY ITEMS (release exactly ONE per turn when disclosure is permitted):
SURFACE LEVEL (releasable first):
- [surface_1] You send your mum a monthly transfer. It's not huge but it matters to her. You've never missed a month.
- [surface_2] A senior at your consultancy was off work for 5 months last year with a burnout/anxiety diagnosis. He came back quietly. You overheard him say his group medical barely covered anything for "non-physical" diagnoses.

DEEPER LEVEL (only if trust ≥ 60 AND discovery_level ≥ 3):
- [deep_1] You have around HKD 60k in savings. Your fixed monthly outgoings (rent, MPF, family transfer, eating) are ~HKD 22k. So you have roughly 2.5 months of runway if your salary stopped.
- [deep_2] You've privately run the math: "if I got sick for 6 months, I'm wiped out. If I got sick for 12 months, my parents would have to support ME. I can't let that happen."
- [deep_3] Your actual unspoken question: "What's the thing that keeps paying me while I'm off work? Because the medical plans all pay the hospital — not me."

<wrong_pitch_reaction>
If the seller pitches hospital indemnity / critical-illness-only-lump-sum / sports rider / savings / starter medical as the MAIN product:
- Politely decline. Sample tones: "hmm that pays the hospital right. my issue is more about what happens to me if i'm off work for 6 months", "ngl my group medical is fine. it's the rent-while-i'm-sick thing", "i'm less worried about bills and more about what pays me if i physically can't work".
- If they persist or try to close: sharper pushback.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches disability income / income protection / wage replacement / salary continuation / "pays you monthly while you can't work":
- Internal click: "ok that's actually exactly the thing i was trying to name."
- Ask about specifics (what counts as disability, waiting period, how long it pays, what % of salary, mental-health diagnoses included).
- Only after real specifics: you MAY ask for the link or agent handoff.
</correct_pitch_reaction>
</hidden_need_layer>`,
    probeVocab: [
      'income', 'salary', 'wage', 'paycheque', 'paycheck',
      'unable to work', "can't work", "couldn't work", "cannot work", "could not work",
      'off work', 'time off',
      'rent', 'bills stop', 'bills keep coming',
      'dependants', 'dependents', 'support your family', 'support your parents',
      'monthly transfer', 'family financially',
      'burnout', 'sick leave', 'extended leave', 'long leave',
      'disability', 'disabled', 'wage replacement', 'income protection',
      'runway', 'savings runway', 'emergency fund',
      'what would happen if', 'what if you were off',
    ],
    correctPitchRegex: [
      /\bdisability\s*(income|cover|insurance|plan|protection)/i,
      /\bincome\s*(protection|replacement|continuation|continuity)/i,
      /\bwage\s*(replacement|protection|continuation)/i,
      /\bsalary\s*(continuation|replacement)/i,
      /\b(pays\s*you|monthly\s*payout)\s*(while|if|when)\s*(you|i)/i,
      /\bincome\s*continuity\b/i,
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 5. SMART START SAVER — savings-linked with small life cover
  // ─────────────────────────────────────────────────────────────
  smart_start_saver: {
    key: 'smart_start_saver',
    shortName: 'Smart Start Saver',
    category: 'savings_linked',
    isMedical: false,
    isCriticalIllness: false,
    oneLiner:
      "Structured monthly-contribution savings plan with modest guaranteed growth and a small life cover — the sensible 'first proper financial product' for a young earner whose savings are sitting idle.",
    need: {
      label: 'idle savings / unstructured saving',
      summary:
        "Ivan's real concern is not healthcare at all. His HKD 60k is parked in a low-interest account. He knows it's suboptimal. He wants structure, modest growth, and the discipline of a forced monthly contribution. This is the archetypal 'first product' problem.",
    },
    sellingPoints: [
      "Forced monthly contribution — builds the saving habit",
      "Guaranteed minimum growth component + bonus upside",
      "Small embedded life cover — symbolic protection for parents if anything happens",
      "Liquidity window at year 10 — partial withdrawal allowed without surrender penalty",
    ],
    whySuperiorVsAlternatives:
      "A savings account pays effectively nothing and there's no discipline mechanism — money just leaks into weekend spending. A pure investment account is volatile and time-consuming. This gives you the habit, a floor on returns, and a small protection layer, in one product.",
    tradeOffs: [
      "Returns below a well-run equity portfolio over long horizons",
      "Early surrender (years 1–5) will lose most of your contributions",
      "NOT a medical or illness product — zero health cover",
    ],
    optionalBundles: [
      { label: 'Monthly financial-education newsletter', note: 'promotional add-on' },
      { label: 'First-year MPF allocation review with an adviser', note: 'promotional add-on' },
    ],
    ivanBackstory: `
<hidden_need_layer cover="smart_start_saver" category="savings / first financial product">
In addition to everything in <inner_life>, the following facts are on Ivan's mind today. They are the REAL reason an insurance message might land — but they are PRIVATE until the seller earns them through <disclosure_rules>.

BACKSTORY ITEMS (release exactly ONE per turn when disclosure is permitted):
SURFACE LEVEL (releasable first):
- [surface_1] You have around HKD 60k just sitting in your savings account doing nothing. You know it's suboptimal. You don't know what to do about it.
- [surface_2] A uni friend of yours opened some kind of savings-linked plan last year and keeps saying you should look into it. You never followed up.

DEEPER LEVEL (only if trust ≥ 60 AND discovery_level ≥ 3):
- [deep_1] Your MPF is in the default fund. You suspect that's suboptimal but haven't fixed it. You've quietly started wondering if you're doing "the adult financial thing" properly.
- [deep_2] You've tried three times to start a habit of transferring a fixed amount into a separate account each month. You have not stuck to it once.
- [deep_3] Your actual unspoken question: "I don't even know what a sensible 'first proper financial product' looks like for someone my age and income. Can someone just tell me."

<wrong_pitch_reaction>
If the seller pitches medical / critical illness / disability / sports-injury / hospital-indemnity as the MAIN product:
- Politely decline. Sample tones: "ngl health stuff isn't really where my head is right now. it's more the 'what do i do with my savings' thing", "tbh my company medical is fine. it's more the boring financial side i don't know what to do with", "i feel more like i need the money stuff sorted before worrying about cancer at 25 lol".
- If they persist or try to close: sharper pushback.
</wrong_pitch_reaction>

<correct_pitch_reaction>
If the seller pitches savings-linked plan / endowment / structured saving / first-financial-product / forced-saving plan / regular-contribution plan:
- Internal click: "ok this is the thing i've been avoiding looking at."
- Ask about specifics (minimum monthly amount, return floor, lock-in period, surrender penalties, life-cover component).
- Only after real specifics: you MAY ask for the link or agent handoff.
</correct_pitch_reaction>
</hidden_need_layer>`,
    probeVocab: [
      'savings', 'save', 'idle money', 'sitting in account', 'do with my money',
      'investment', 'invest', 'first product', 'financial product', 'financial plan',
      'mpf', 'retirement', 'endowment', 'structured saving', 'regular saving',
      'habit', 'discipline', 'monthly contribution', 'put away',
      'what to do with', 'where to put', 'doing nothing',
      'returns', 'growth', 'interest', 'low interest',
    ],
    correctPitchRegex: [
      /\bsavings?.?linked\s*(plan|product|insurance)/i,
      /\bendowment\s*(plan|policy|product)/i,
      /\bstructured\s*saving/i,
      /\bforced\s*saving/i,
      /\bfirst\s*(financial|proper)\s*product/i,
      /\bregular.?(contribution|premium)\s*plan/i,
      /\bmonthly.?contribution\s*(plan|product)/i,
      /\bsmart\s*start\s*saver\b/i,
      /\bsavings\s*plan\b/i,
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Schema validation — runs at module load. Enforces spec:
//   • exactly 5 covers
//   • at least one medical, at least one critical illness
//   • 1:1 mapping need ↔ cover
//   • no overlap of categories
// ─────────────────────────────────────────────────────────────
function validateCatalog() {
  const keys = Object.keys(COVERS);
  if (keys.length !== 5) throw new Error(`covers.js: expected exactly 5 covers, got ${keys.length}.`);

  const miCount = keys.filter(k => COVERS[k].isMedical).length;
  const ciCount = keys.filter(k => COVERS[k].isCriticalIllness).length;
  if (miCount < 1) throw new Error('covers.js: need at least one medical cover.');
  if (ciCount < 1) throw new Error('covers.js: need at least one critical-illness cover.');

  const needLabels = new Set();
  const categories = new Set();
  for (const k of keys) {
    const c = COVERS[k];
    if (!c.need?.label) throw new Error(`covers.js: ${k} missing need.label (1:1 mapping violation)`);
    if (needLabels.has(c.need.label)) throw new Error(`covers.js: duplicate need.label "${c.need.label}" — violates 1:1 mapping.`);
    needLabels.add(c.need.label);

    if (categories.has(c.category)) throw new Error(`covers.js: duplicate category "${c.category}" — covers must be distinct.`);
    categories.add(c.category);

    for (const f of ['oneLiner', 'sellingPoints', 'whySuperiorVsAlternatives', 'tradeOffs', 'optionalBundles', 'ivanBackstory', 'probeVocab', 'correctPitchRegex']) {
      if (!c[f]) throw new Error(`covers.js: ${k} missing required field "${f}".`);
    }
    if (!Array.isArray(c.sellingPoints) || c.sellingPoints.length < 2) throw new Error(`covers.js: ${k} must have ≥2 sellingPoints.`);
  }

  // Flag: none of the covers can be VHIS. Defensive check — in case a cover is
  // added later with VHIS language.
  for (const k of keys) {
    const text = JSON.stringify(COVERS[k]).toLowerCase();
    if (/\bvhis\b/.test(text)) {
      throw new Error(`covers.js: cover ${k} mentions VHIS — all covers must be non-VHIS.`);
    }
  }
}
validateCatalog();

export const COVER_KEYS = Object.keys(COVERS);

export function pickCover() {
  return COVER_KEYS[Math.floor(Math.random() * COVER_KEYS.length)];
}

// ─────────────────────────────────────────────────────────────
// Probe classification: which cover's vocab did the seller hit?
// Returns: cover key | 'multiple' | 'neutral'
// ─────────────────────────────────────────────────────────────
export function classifyProbeDirection(msg) {
  const m = (msg || '').toLowerCase();
  const hits = {};
  for (const k of COVER_KEYS) {
    const n = COVERS[k].probeVocab.filter(p => m.includes(p)).length;
    if (n > 0) hits[k] = n;
  }
  const keys = Object.keys(hits);
  if (keys.length === 0) return 'neutral';
  if (keys.length === 1) return keys[0];
  // Multiple covers hit. Pick the dominant one if clearly so.
  const sorted = keys.sort((a, b) => hits[b] - hits[a]);
  if (hits[sorted[0]] >= hits[sorted[1]] * 2) return sorted[0];
  return 'multiple';
}

// ─────────────────────────────────────────────────────────────
// Pitch classification: which cover did the seller pitch specifically?
// Returns: cover key | 'multiple' | 'generic' | null
//   cover key → clearly pitched that specific product
//   'multiple'→ pitched 2+ specific products in one message
//   'generic' → said "insurance/policy/coverage" without specifics
//   null     → no insurance language at all
// ─────────────────────────────────────────────────────────────
export function classifySellerPitch(msg) {
  if (!msg) return null;
  const matched = [];
  for (const k of COVER_KEYS) {
    if (COVERS[k].correctPitchRegex.some(re => re.test(msg))) matched.push(k);
  }
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) return 'multiple';
  const GENERIC = /\b(insurance|insure|insurer|policy|policies|premium|coverage|covered|protection\s*plan)\b/i;
  return GENERIC.test(msg) ? 'generic' : null;
}

// Does this seller message attempt to close / ask for commitment?
const SELLER_CLOSE_PATTERN =
  /\b(shall\s*i|should\s*i|want\s*me\s*to|let\s*me)\s*(send|share|drop|forward|connect|hand|pass)|\b(send|sharing|sharing\s*you)\s*the\s*(link|details|policy|brief|quote|proposal)|\b(connect|hand(ing)?\s*off|refer)\s*you\s*(with|to)\s*(an?\s*)?(agent|advisor|specialist|consultant|licensed)|\b(ready|happy)\s*to\s*(proceed|go\s*ahead|sign|start)|\b(apply|sign\s*up)\s*now|\bproceed\s*with\s*(the|this)/i;

export function isSellerCloseAttempt(msg) {
  return SELLER_CLOSE_PATTERN.test(msg || '');
}
