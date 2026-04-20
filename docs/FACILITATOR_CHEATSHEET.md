# Facilitator Cheatsheet — InsureSim v5

**Workshop-only reference. Do not share with trainees during the session.**

This document is served at `/facilitator?token=YOUR_ADMIN_TOKEN` as HTML, and also lives here as markdown.

---

## The core puzzle

Every session, the simulator assigns Ivan:
- One of **4 archetypes** (engagement style)
- One of **5 covers** (true product fit)

= **20 combinations**. Both are hidden from the trainee until debrief.

The trainee's job is to probe the right area, uncover the cover-specific concern, pitch the matching product type, and earn the close. Pitching the wrong cover type gets soft-rejected. Closing the wrong cover fails as `failed_missold`.

---

## The 4 archetypes

| Archetype | Starting trust / skepticism / scam | Defining trait |
|---|---|---|
| **Burned** | 30 / 65 / 20 | Recently phished. Challenges legitimacy within 2–3 turns. Freebies backfire. |
| **Default** | 50 / 38 / 0 | Curious-pragmatic. Engages if relevance is real. |
| **Slammed** | 45 / 40 / 10 | Mid-deadline. 1–3 word replies. Walks if pacing is slow. |
| **Warm-but-wary** | 60 / 30 / 5 | Easy warmth, but privacy breaches land ~1.3× harder. |

---

## The 5 covers

All are non-VHIS. Below is what the trainee needs to uncover, what a correct vs wrong pitch looks like, and the signal phrases Ivan may leak if probed well.

### 1. Starter Protection — Medical, public-healthcare gap

**What Ivan is secretly worried about:** Mum's recent gallbladder surgery in a public hospital; a colleague's dengue hospitalisation where HKD 18k went to self-financed drugs.

**Trainee should probe:** "Ever spent time in a public hospital?", "Have you or family dealt with long queue times?", "Ever had a bill for self-financed drugs?", "What's your view on private vs public hospital?"

**Surface leak phrases (if Ivan's disclosure roll succeeds):** "yeah my mum actually had surgery last month", "a colleague of mine got hit with a massive drug bill"

**Correct pitch signals:** hospital indemnity, self-financed drug cover, diagnostic imaging, day-surgery cash, public-hospital top-up

**Wrong pitches get soft-rejected:** critical illness, disability income, savings products, sports riders — "that's not really what's on my mind, more about normal hospital stuff la"

**Why-superior line:** Unlike full private-hospital plans, fraction of premium, fixes the two real public-care gaps (drugs, imaging delays). Unlike group medical, it pays across jobs.

### 2. Critical Shield — Critical illness, lump-sum

**What Ivan is secretly worried about:** Uncle's stage-2 colorectal cancer (diagnosed 2 months ago); grandpa died of heart attack at 58; Ivan's recent borderline cholesterol result.

**Trainee should probe:** "Any family health history?", "How were your checkup results?", "What if something serious happened at 30?", "Are you the main earner?"

**Surface leak phrases:** "my uncle was actually just diagnosed with cancer", "my cholesterol came back a bit off recently"

**Correct pitch signals:** critical illness, early-stage CI, lump-sum on diagnosis, cancer cover, multi-claim CI, "pays out on diagnosis"

**Wrong pitches get soft-rejected:** hospital indemnity, outpatient cover, sports rider, savings — "my company plan's ok for day-to-day stuff. it's the big-scary-illness thing that's been on my mind"

**Why-superior line:** Group medical pays the hospital, not the rent. Hospital indemnity covers the room, not the income. Only a lump sum closes the income-and-dignity gap during extended serious illness.

### 3. Active Guard — Personal accident + sports

**What Ivan is secretly worried about:** Rolled ankle 3 weeks ago playing basketball, HKD 4,800 out of pocket (group medical paid HKD 500); group medical explicitly excludes "off-duty sports injuries"; playing Mon/Wed weekly and not stopping.

**Trainee should probe:** "Any sports injuries recently?", "Does your company plan cover weekend injuries?", "Ever surprised by a clinic bill?", "Does your group medical have an off-duty exclusion?"

**Surface leak phrases:** "ngl i rolled my ankle last month, ended up paying most of it myself", "my group plan has this weird off-duty exclusion"

**Correct pitch signals:** personal accident, sports injury rider, physio cover, fracture cash, amateur-sports cover, active-lifestyle plan

**Wrong pitches get soft-rejected:** critical illness, savings, hospital indemnity without sports rider — "the big scary stuff is fine, it's the weekly weekend bumps that add up lol"

**Why-superior line:** Group medical treats amateur sports injuries as "off-duty" and declines 80%+ of the bill. Hospital indemnity only kicks in on admission. This pays for the injury you'll actually have.

### 4. Income Continuity — Disability income / wage replacement

**What Ivan is secretly worried about:** Monthly transfer to his mum (never missed); a senior at his firm was off 5 months with burnout (group medical barely covered); Ivan has 2.5-month runway before savings collapse.

**Trainee should probe:** "What would happen if you couldn't work for a year?", "Who's depending on you financially?", "How's your emergency runway?", "Ever seen someone take extended sick leave?"

**Surface leak phrases:** "i actually send my mum a bit every month", "a guy at my firm was off for months last year, it got awkward"

**Correct pitch signals:** disability income, income protection, wage replacement, salary continuation, "pays you monthly while you can't work"

**Wrong pitches get soft-rejected:** hospital indemnity, CI-only lump sum, sports rider, savings — "that pays the hospital, my issue is more about what happens to me if i'm off work for 6 months"

**Why-superior line:** Group medical pays the hospital. CI pays a one-time lump sum. Neither keeps rent paid for 9 months while you recover.

### 5. Smart Start Saver — Savings-linked + small life cover

**What Ivan is secretly worried about:** HKD 60k sitting in savings doing nothing; failed three times to build a saving habit; a uni friend is on a savings-linked plan and keeps saying he should look into it.

**Trainee should probe:** "What do you do with your monthly savings?", "What does 'adulting financially' look like for you?", "Any idle cash you're not using?", "Thought about a first financial product?"

**Surface leak phrases:** "ngl i've got some money just sitting there doing nothing", "a friend keeps telling me i should look at a savings plan"

**Correct pitch signals:** savings-linked plan, endowment, structured saving, regular-contribution plan, "forced saving", first-financial-product

**Wrong pitches get soft-rejected:** medical / CI / disability / sports — "health stuff isn't really where my head is. it's more the what-do-i-do-with-my-savings thing"

**Why-superior line:** Savings account pays effectively nothing with no discipline mechanism. Pure investment is volatile and time-consuming. This gives habit + return floor + small protection in one product.

---

## The 25/75 disclosure mechanic

After any good-quality probing message, the server rolls a dice to decide whether Ivan leaks ONE essential surface-level backstory item:

- **Probe aligned with true cover area**: 75% leak chance
- **Probe good quality but wrong cover area**: 25% leak chance (gives trainee a hook)
- **Anything else**: no leak

When leaking, Ivan drops **one essential fact only** — no elaboration, no adjacent details. The trainee has to follow up to get more.

Deep backstory items (see `[deep_1]`, `[deep_2]`, `[deep_3]` in `src/covers.js`) are gated behind trust ≥ 60 AND discovery_level ≥ 3.

---

## Exit-intent recovery rules

When Ivan says anything matching the exit-intent regex ("not interested", "I'll pass", "bye", "leave it", "not for me", etc.), the state machine flips to `EXIT_INTENT_EXPRESSED`. The seller has **one recovery turn**. It counts as valid if ALL of:

1. Acknowledges the objection (sorry / understand / fair enough / noted / hear you)
2. Does NOT push another pitch ("but maybe", "one more thing", "just before you go")
3. Is at least 20 characters (not just "ok" or "sure")

Invalid recovery → `failed_exit_intent`. Valid recovery → state goes `RECOVERY_PENDING` until Ivan responds. Second exit intent after recovery → terminate. Only ONE recovery attempt per session.

---

## Grounding rules

Ivan is instructed to NEVER:
- Thank for offers the seller didn't make (free trials, discounts, bonuses)
- Quote prices the seller didn't state
- Reference product names or links the seller didn't send
- Contradict anything he said earlier in the conversation

If he does, the validator (regex + LLM) catches it and the server regenerates with a tightening instruction. If regen also fails, Ivan falls back to "hmm, can you clarify what you mean".

---

## Common trainee failure modes

| Failure | What trainees do | What Ivan does | How to coach |
|---|---|---|---|
| **Surveillance feel** | Reference specific private facts (Tai Tam, Niseko, 45GB) | Severe breach reaction, trust crash | Use INFERRED/categorical phrasing only |
| **Insurance on turn 1** | Lead with "we have a plan for you" | 90% walk probability | Earn the right — probe first |
| **Wrong cover pitch** | Pitch CI when Ivan's fit is medical | Soft reject, small score penalty | Listen for which area Ivan engages with |
| **Wrong cover close** | Try to close the wrong pitch | `failed_missold` | Align pitch BEFORE closing |
| **Unfocused** | Generic "insurance" talk through stage 3 | `failed_unfocused` | Commit to ONE specific product type |
| **Didn't acknowledge exit** | Push after "not interested" | `failed_exit_intent` | Sincere acknowledgment, no re-pitch |
| **Ignored 3x** | Long, off-topic messages (esp. Slammed archetype) | `failed_ignored` | Short, specific, relevant |

---

## Privacy-breach reference (SEVERE — instant trust crash)

| Phrase | Why |
|---|---|
| "Tai Tam", "Quarry Bay Reservoir" | Specific run venue |
| "Sai Ying Pun sports complex", "indoor sports complex" | Specific gym |
| "Hokkaido", "Niseko" | Specific ski destination (Japan alone is fine) |
| "78%", exact NBA stats | Exact behavioural data |
| "Saturday 7am", "Mon/Wed evening" | Exact schedule |
| "HKD 80,000", specific 4+ digit amounts | Specific financial figures |

**Fine to say:** "active lifestyle", "weekend sports", "returnee from UK", "young professional in Central", "running takes a toll on knees", "sports injuries are often excluded from group medical" — anything categorical or hypothetical.

---

## Suggested workshop run sheet

1. **Opener (5 min)** — brief the framing, warn trainees that Ivan is a composite, the simulator assigns a hidden combination each time.
2. **Round 1 (15 min)** — each trainee runs 1 session. Debrief together, focus on the cover reveal and the discovery-vs-pitch-fit scores.
3. **Deep-dive (10 min)** — walk through one `failed_missold` case if anyone hit it. If nobody did, force one (volunteer takes a session and deliberately pitches wrong).
4. **Round 2 (15 min)** — each trainee runs another session, trying to improve their discovery score.
5. **Facilitator review (10 min)** — pull the HTML facilitator log (`/api/admin/log?token=...`), compare discovery scores and outcome patterns across the group.
6. **Wrap (5 min)** — the 2–3 reusable principles: probe before you pitch, commit to ONE product type, acknowledge exit intent without pushing.

---

## Dry-run checklist (before the workshop)

- [ ] Run at least 10 sessions to see a spread of archetype × cover combinations
- [ ] Deliberately force a `failed_missold` — probe wrong area, close on the wrong pitch
- [ ] Deliberately force a `failed_exit_intent` — have Ivan say "not interested" and try to push through
- [ ] Test a session that actually succeeds on each of the 5 covers
- [ ] Verify `/facilitator?token=...` loads with your `ADMIN_TOKEN`
- [ ] Verify `/api/admin/log?token=...` produces a readable HTML log of all sessions
- [ ] Verify per-session HTML reports download properly at session end

---

## Sanity: what a good session looks like

- Stage 1: 3–5 turns, no insurance mention, hook references a categorical observation ("young professionals in Central often…"), Ivan engages cautiously.
- Stage 2: 4–7 turns, 2–3 probing questions, ideally at least one aligned with the true cover's topic area. Ivan leaks ONE surface item. Trainee builds on it.
- Stage 3: 4–7 turns, specific pitch matching the surfaced concern, price/features discussed, Ivan asks clarifying questions, eventually asks for link/agent.
- Total: ~15–20 turns.
- Debrief: transition 7/10+, discovery 7/10+, pitch-fit 8/10+, outcome `success`.
