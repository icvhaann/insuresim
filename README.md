# InsureSim v4

Internal sales-training simulator. Workshop tool for sellers learning to probe, discover, and pitch the right insurance cover to a HK consumer persona ("Ivan C.").

v4 addresses the 5 problems specified in the v4 brief: stage-transition guards, strict grounding, memory consistency, 5-cover 1:1 mapping, and Niseko de-emphasis.

---

## Quick deploy (Railway)

1. `git push` this directory to a new repo.
2. New Railway project → deploy from repo.
3. Environment variables (Settings → Variables):
   - `DEEPSEEK_API_KEY` — required.
   - `DEEPSEEK_MODEL` — optional, defaults to `deepseek-chat`.
   - `ADMIN_TOKEN` — required if you want the facilitator HTML export or the `/facilitator` cheatsheet. Generate a long random string.
4. Railway picks up `npm start` automatically.
5. After each workshop: rotate the DeepSeek API key.

## Local

```
cp .env.example .env          # fill in DEEPSEEK_API_KEY
npm install
npm test                      # run the test scenarios (offline, no API needed)
npm start                     # http://localhost:3000
```

---

## Workshop flow

- Trainee opens the URL, hits **Start Session**.
- Simulator draws **one of four archetypes** AND **one of five covers** at random (both hidden until debrief). 20 possible combinations per session.
- Three stages: Hook → Cultivate → Convert.
- Trainee's job: (a) open without being creepy, (b) probe the right topic area to uncover Ivan's real cover need, (c) pitch the matching product type, (d) earn the close.
- Possible outcomes:
  - `success` — Ivan asks for link/agent AND the latest specific pitch matches his true cover
  - `failed_missold` — Ivan agreed, or the seller tried to close, on the **wrong** cover
  - `failed_unfocused` — Ivan agreed / Stage 3 ran out, but the seller never pitched a specific cover
  - `failed_exit_intent` — Ivan expressed exit intent and the seller's recovery didn't land
  - `walked` — Ivan walked after insurance was mentioned too early
  - `failed_optout` — Ivan asked to be removed
  - `failed_ignored` — Ivan stopped replying for 3+ turns
  - `failed_stage` — a stage timed out without enough engagement
- At the end: a debrief overlay shows product-fit review, the cover reveal with full product card, transition naturalness, key moments, archetype reveal, and an exemplar bridge.
- Trainee downloads a polished HTML report (printable to PDF).

## Facilitator access (`ADMIN_TOKEN` required)

- `/api/admin/log?token=YOUR_TOKEN` — HTML list of every session in memory
- `/api/admin/log.json?token=YOUR_TOKEN` — raw JSON for debugging
- `/facilitator?token=YOUR_TOKEN` — in-browser cheatsheet (archetypes, covers, probe signals, run-sheet)

---

## The 5 covers

All non-VHIS. Each session, ONE is assigned as Ivan's true fit. The trainee must uncover which through conversation.

| Cover | Category | What's on Ivan's mind if this is his true cover |
|---|---|---|
| Starter Protection | Medical — public-healthcare gap | Mum's gallbladder surgery; a colleague's dengue + HKD 18k in self-financed drugs |
| Critical Shield | Critical illness | Uncle's stage-2 cancer; grandpa's heart attack at 58; Ivan's borderline cholesterol |
| Active Guard | Personal accident + sports | Rolled ankle 3 weeks ago, HKD 4,800 out of pocket; group medical's "off-duty" exclusion |
| Income Continuity | Disability income | Monthly transfer to mum; 2.5-month runway; colleague's 5-month burnout leave |
| Smart Start Saver | Savings-linked | HKD 60k sitting idle; failed three times to build a saving habit; "what's the first proper financial product" |

Each cover comes with selling points, trade-offs, optional promotional bundles, and a "why superior vs alternatives" line (see `src/covers.js`).

---

## What changed vs v3

### Problem 1 — stage-transition guards
Previously the client advanced stages based on score accumulator only. "not interested" didn't end the session. v4 introduces an explicit server-side state machine (`src/stateMachine.js`) with states `NORMAL` / `EXIT_INTENT_EXPRESSED` / `RECOVERY_PENDING` / `RECOVERED` / `TERMINATED`. Stage advance is blocked while not in NORMAL or RECOVERED. Exit intent triggers ONE recovery turn (seller must acknowledge, not push, ≥20 chars). Bad recovery → terminate. Second exit intent after recovery → terminate.

### Problem 2 — strict grounding
v3 had no validator. v4 adds a two-layer validator (`src/validator.js`):
- **Regex layer** — catches 5 common hallucinations: free-offer ack when none offered, specific price/HKD, discount ack, link/URL ack, product-name mention. Fires on every reply, zero cost.
- **LLM layer** — runs on replies ≥15 words OR when regex already flagged. Strict-JSON validator that checks Ivan's reply against the actual conversation log. Returns `grounded: bool + issue`.

On failure, one regeneration pass with a tightening instruction. If that also fails, fallback to a safe short reply.

Grounding rules were also added to the system prompt (`<grounding_rules>` block in `personas.js`): strict-grounding, self-consistency, and hierarchy (log > state > background).

### Problem 3 — memory & consistency
v3 tracked seller-raised topics only. v4 adds `<revealed_facts>` tracking — every backstory item Ivan discloses is tagged server-side (output contract's `disclosed_fact` field) and shown back in the prompt so Ivan can't contradict himself. Append-only; persists across turns via client→server round-trip.

### Problem 4 — 5 covers, 1:1 mapping
v3 was binary (MI vs CI). v4 replaces with a 5-cover catalog (`src/covers.js`) validated at module load: exactly 5, ≥1 medical, ≥1 critical-illness, 1:1 need labels, unique categories, non-VHIS. Each has selling points, trade-offs, optional bundles (labelled as promotional), and a "why superior" line. Probe and pitch classifiers are cover-specific.

### Problem 5 — Niseko de-emphasis
v3 made Niseko a dominant signal for the medical cover. v4 demotes Niseko to a one-line incidental background detail in `<inner_life>` ("a uni friend had some kind of skiing incident in Japan, you heard about it secondhand"). It's no longer listed as a signal phrase for any cover. The `friendStory` memory flag is gone. Niseko remains in the PRIVATE facts list (if the seller mentions it by name, still a breach).

### Also new in v4
- `isExitIntent()` regex (previously dead code in v3's `breaches.js`, now properly wired)
- 25/75 disclosure mechanic — server-computed probabilistic gate injected into the turn-instruction block (aligned probes leak 75% of the time, good-but-unaligned probes leak 25%, always "essential only, no elaboration")
- Test suite (`tests/scenarios.mjs`) — 93 assertions covering the 5 test cases from the brief, runs offline with no API calls

---

## Architecture notes

**Source-of-truth hierarchy** (enforced in `<grounding_rules>`):
1. Conversation log (what was literally said)
2. Explicit structured state (`<revealed_facts>`, `<conversation_memory>`, `<current_state>`)
3. Background instructions (persona document — private until disclosed)

When (1) and (3) disagree, the log wins.

**Server is the single source of truth** for: archetype, cover, session state, disclosure permission, stage-advance guards, grounding validation, audit log. The client mirrors state for UI but cannot drift — every chat round-trip re-syncs.

**Cost**: roughly $0.002 per turn (persona + validator + optional breach judge), plus ~$0.005 at session end (transition + key moments + exemplar + need-discovery judges in parallel). Workshop of 30 trainees × 30 turns ≈ USD $3–5 total. The LLM validator is the main cost addition over v3 (~30% more).

---

## Test scenarios (from the brief)

`npm test` runs all five scenarios offline:

1. **Exit intent terminates** — "not interested", "bye", "I'll pass" all trigger state machine; bad recovery = terminate.
2. **Source challenge, no hidden advance** — "where did you get my number" flagged as `data_source`; stage does not advance on low score.
3. **Hallucinated offer blocked** — "thanks for the free trial" when none offered → validator flags; when one WAS offered → passes. Same for prices and product names.
4. **Multi-turn revealed-facts** — append-only tracking of disclosed backstory items, order preserved.
5. **Insurance mapping** — exactly 5, 1:1 need labels, unique categories, ≥1 MI, ≥1 CI, all non-VHIS, all required fields present, bundles labelled promotional, probe/pitch classifiers work for each cover.

93 assertions total. All pass.

---

## Cost (DeepSeek-V3.2)

Per turn:
- Persona call: ~$0.001
- Validator: ~$0.0005 when it fires (replies ≥15 words or regex-flagged); regeneration adds another ~$0.001 when triggered
- Optional breach judge: ~$0.0005 when triggered

End-of-session (parallel judges): ~$0.005

Workshop of 30 trainees × ~30 turns ≈ USD $3–5.

---

## Dry-run before workshop

With 4 archetypes × 5 covers = 20 combos, expect **15–20 sessions** in dry-run to see a good spread. The hardest lesson is still the mis-sell outcome — probe the wrong cover direction and close on it, watch the `failed_missold` flag and debrief coaching note. Do it at least twice in dry-run so you know what the trainee will see.

Rough archetype behaviours (unchanged from v3):
- **Default** — baseline.
- **Burned** — challenges legitimacy within 2–3 turns; freebies backfire.
- **Slammed** — 1–3 word replies; long messages get "tldr".
- **Warm-but-wary** — easy warmth, breaches land ~1.3× harder.

---

## File map

```
server.js                        — Express app, endpoints, orchestration
src/
  personas.js                    — Base Ivan + 4 archetypes + grounding rules
  covers.js                      — NEW: 5-cover catalog with schema validation
  prompts.js                     — System prompt assembly + disclosure permission mechanic
  breaches.js                    — Regex patterns incl. expanded exit-intent
  stateMachine.js                — NEW: session state + recovery logic
  validator.js                   — NEW: regex + LLM grounding validator
  judges.js                      — LLM judges (breach, transition, key moments, exemplar, need-discovery)
  scoring.js                     — Per-turn 1-10 score with cover-specific alignment
  audit.js                       — In-memory session log
  logExport.js                   — HTML render for per-session + facilitator exports
public/
  index.html                     — Shell
  app.js                         — Frontend state, UI, HTTP; mirrors server state
  styles.css                     — Styles
tests/
  scenarios.mjs                  — NEW: 5 test scenarios, 93 assertions, offline
docs/
  FACILITATOR_CHEATSHEET.md      — Facilitator-only workshop reference
```

---

## Known limits

- Same production caveats as v2/v3: the framing is a workshop construct; real HK PDPO Part 6A / IA GL25 deployment would require explicit consent.
- Audit log remains in-memory. Railway restart mid-workshop = lost data. Swap `src/audit.js` for persistent storage if needed.
- The LLM validator cannot catch ALL grounding drift — the regex layer covers the common cases cheaply; the LLM layer adds conservative coverage for longer replies. Persistent creative hallucinations may still slip through; check the audit log for `validator.regenAttempted` counts after workshops.
- Pitch classification is regex-based. Unusual phrasings ("big-illness protection that pays a chunk on diagnosis") may classify as `generic` even when they're clearly CI. The need-discovery judge at debrief provides a second opinion that's not regex-constrained.
- 20 combos × workshop scale: not every trainee will see every combo. The facilitator cheatsheet explains all 5 covers so anything the trainee hits can be debriefed meaningfully.
