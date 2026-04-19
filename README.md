# InsureSim v3

Internal sales-training simulator. Workshop tool for sellers learning to bridge from a personalised hook into an insurance pitch with a HK consumer persona ("Ivan C.").

This is v3. Key changes vs v2 summarised at the bottom.

---

## Quick deploy (Railway)

1. `git push` this directory to a new repo.
2. New Railway project → deploy from repo.
3. Environment variables (Settings → Variables):
   - `DEEPSEEK_API_KEY` — required.
   - `DEEPSEEK_MODEL` — optional. Defaults to `deepseek-chat` (DeepSeek-V3.2). Don't use `deepseek-reasoner` — JSON mode behaves worse with the thinking model.
   - `ADMIN_TOKEN` — required for the facilitator HTML export **and** the in-browser facilitator cheatsheet at `/facilitator`. Generate a long random string.
4. Railway picks up `npm start` automatically.
5. After each workshop: rotate the DeepSeek API key.

## Local

```
cp .env.example .env          # fill in DEEPSEEK_API_KEY (and ADMIN_TOKEN if you want the cheatsheet)
npm install
npm start                     # http://localhost:3000
```

---

## Workshop flow

- Trainee opens the URL, hits **Start Session**.
- The simulator draws **one of four archetypes** AND **one of two insurance needs** at random (both hidden until the debrief). Eight possible combinations per session.
- Three stages: Hook → Cultivate → Convert.
- Each stage has min turns / max turns / score thresholds. Falling below means stage failure; crossing the threshold advances.
- The trainee's job is to (a) open without being creepy, (b) probe the right topic area to uncover Ivan's real concern, (c) pitch the **right product type** — medical / hospital indemnity OR critical illness / lump sum — and (d) earn the close.
- Possible outcomes:
  - `success` — Ivan asks for link / agent AND the latest specific pitch matches his real need
  - `failed_missold` — Ivan agreed, or the seller tried to close, on the **wrong** product type
  - `failed_unfocused` — Ivan agreed, but the seller never pitched a specific product type
  - `walked` — Ivan walked after insurance was mentioned too early
  - `failed_optout` — Ivan asked to be removed
  - `failed_ignored` — Ivan stopped replying for 3+ turns
  - `failed_stage` — a stage timed out without enough engagement
- At the end: a debrief overlay shows a product-fit review (new), the insurance-need reveal, scorecard, transition naturalness score, key moments, the archetype reveal, and an exemplar bridge.
- The trainee downloads a **polished HTML report** from the debrief overlay (printable to PDF).

## Facilitator access (`ADMIN_TOKEN` required)

**Full HTML export** — every session held in memory, rendered as a printable report:
```
/api/admin/log?token=YOUR_ADMIN_TOKEN
```

**JSON fallback** — raw audit data for debugging:
```
/api/admin/log.json?token=YOUR_ADMIN_TOKEN
```

**Cheatsheet** — in-browser, token-gated, rendered from `docs/FACILITATOR_CHEATSHEET.md`:
```
/facilitator?token=YOUR_ADMIN_TOKEN
```

The cheatsheet covers: the 4 archetypes, both insurance-need variants (backstories + signal phrases + correct pitch direction), thematic anchors per stage, common failure modes, privacy-breach reference, and a suggested workshop run sheet.

---

## What changed vs v2

| Area | v2 | v3 |
|---|---|---|
| Persona dimensions | Archetype only (4 options) | Archetype × insurance need (4 × 2 = 8 combos) |
| Hidden layer | None beyond archetype | Medical vs critical-illness need with distinct backstories, discovery gates, soft-rejection lines, and correct-pitch signals |
| Scoring | Based on privacy and engagement | Also factors in probe-direction alignment (Stage 2) and pitch-type alignment (Stage 3) |
| Stage 3 wrong-pitch | Undifferentiated | Ivan soft-rejects wrong type; hard-fails only on close attempts |
| Outcomes | `success` / `walked` / `failed_optout` / `failed_ignored` / `failed_stage` | Adds `failed_missold` (wrong product closed) and `failed_unfocused` (no specific product ever pitched) |
| Debrief | Transition + key moments + exemplar + archetype reveal | Adds **product-fit review** (discovery score, pitch-fit score, coaching note) and **insurance-need reveal** |
| Log export | JSON only | Polished HTML (per-session + facilitator full export), printable to PDF, C-suite-friendly |
| Facilitator docs | None | Token-gated `/facilitator` route serving a markdown cheatsheet as HTML |
| Discovery mechanic | Binary | Server tracks `discoveryLevel` (aligned-probe counter); Ivan progressively shares backstory |
| Client state | Psych + memory | Adds `discoveryLevel`, `latestSpecificPitch`, `wrongCloseCount`; memory mirrors server-side probe / wrong-pitch signals |

---

## Cost (DeepSeek-V3.2)

Roughly $0.001–0.002 per turn (persona + occasional judge). End-of-session adds ~$0.004 (transition + key-moments + exemplar + **need-discovery** judges run in parallel). A full workshop of 30 trainees × ~30 turns per session is around USD $1.50–2.50.

---

## Dry-run before the workshop

You now want at least **8 sessions** to see each combo at least once (4 archetypes × 2 needs). In practice you'll probably want 12–16 so you've seen each combo go well AND go poorly. The hardest lesson — the **mis-sell outcome** — appears when the seller locks onto the wrong product direction and closes anyway. Force one of these in your dry-run so you can talk about what the sim flags and how.

Rough archetype behaviours (unchanged from v2):
- **Default**: baseline.
- **Burned**: challenges legitimacy within 2–3 turns.
- **Slammed**: 1–3 word replies. Long messages get "tldr".
- **Warm-but-wary**: easy warmth, but breaches land ~1.3× harder.

New in v3 — the two insurance needs:
- **Medical / hospital indemnity** (MI): Ivan has a recent HKD 4,800 out-of-pocket after rolling an ankle; his mum had surgery last month; his friend's Niseko story is top of mind. Correct pitch: hospital indemnity / outpatient / sports rider / private-room cover / VHIS.
- **Critical illness** (CI): Ivan's uncle has stage-2 cancer; his grandfather died of a heart attack at 58; Ivan's own checkup came back with borderline cholesterol. Correct pitch: critical illness / early CI / cancer lump-sum / income protection / multi-claim CI.

See `docs/FACILITATOR_CHEATSHEET.md` (or `/facilitator?token=...`) for the full reference.

---

## File map

```
server.js                        — Express app, endpoints, orchestration, HTML routes
src/personas.js                  — Base Ivan + 4 archetypes + privacy taxonomy
src/insuranceNeeds.js            — NEW: MI vs CI variants, backstories, pitch/probe classifiers
src/prompts.js                   — System prompt assembly, turn instruction, need-aware pre-scoring
src/breaches.js                  — Regex patterns, walk-away probability
src/judges.js                    — LLM judges (breach, transition, key moments, exemplar, need-discovery)
src/scoring.js                   — Per-turn 1-10 score with alignment factor
src/audit.js                     — In-memory session log with debrief attachment
src/logExport.js                 — NEW: HTML render for per-session + facilitator exports
docs/FACILITATOR_CHEATSHEET.md   — NEW: facilitator-only workshop reference
public/index.html                — Shell
public/app.js                    — Frontend logic (state, UI, HTTP), v3 state additions
public/styles.css                — Styles
```

---

## Known limits / things to revisit

- Same production caveats as v2: framing is a workshop construct; real HK PDPO Part 6A / IA GL25 deployment would require explicit consent.
- Audit log remains in-memory. Railway restart mid-workshop = lost data. Swap `src/audit.js` for persistent storage if needed.
- DeepSeek model realism is the bottleneck for persona authenticity. Consider `gpt-4o` or `claude-sonnet` for the persona call if stiffness appears.
- Pitch classification is regex-based. Creative phrasings that avoid canonical product terminology ("big-illness protection that pays a chunk on diagnosis") may be classified as `generic` even when they're genuinely CI. The need-discovery LLM judge at debrief provides a second opinion that is NOT regex-constrained.
- The borderline-breach judge still fires only on private-adjacent regex triggers. Tune in `server.js` if false-negatives appear.
