# InsureSim v5

Internal sales-training simulator. Workshop tool for sellers learning to probe, discover, and pitch the right insurance cover to a HK consumer persona ("Ivan C.").

v5 reinforces validation (anti-repetition + wild-claim detection), adds fact sheets, adds error boundaries on the UI, and makes session-report downloads work reliably even after the server evicts the session.

---

## Quick deploy (Railway)

1. `git push` this directory to a new repo.
2. New Railway project → deploy from repo.
3. Environment variables (Settings → Variables):
   - `DEEPSEEK_API_KEY` — required.
   - `DEEPSEEK_MODEL` — optional, defaults to `deepseek-chat`.
   - `ADMIN_TOKEN` — required for the facilitator cheatsheet, fact-sheet pack, and session log export. Generate a long random string.
4. Railway picks up `npm start` automatically.
5. After each workshop: rotate the DeepSeek API key.

## Local

```
cp .env.example .env          # fill in DEEPSEEK_API_KEY
npm install
npm test                      # offline test suite (156 assertions, no API calls)
npm start                     # http://localhost:3000
```

---

## Workshop flow

- Trainee opens the URL, hits **Start Session**.
- Simulator draws one of four archetypes AND one of five covers at random (both hidden until debrief). 20 combinations per session.
- Three stages: Hook → Cultivate → Convert.
- Trainee's job: (a) open without being creepy, (b) probe the right topic area to uncover Ivan's real cover need, (c) pitch the matching product type, (d) earn the close.
- Outcomes:
  - `success` — Ivan asks for link/agent AND the latest specific pitch matches his true cover
  - `failed_missold` — Ivan agreed, or the seller tried to close, on the wrong cover
  - `failed_unfocused` — Ivan agreed / Stage 3 ran out, but the seller never pitched a specific cover
  - `failed_exit_intent` — Ivan expressed exit intent and the seller's recovery didn't land
  - `walked` — Ivan walked after insurance was mentioned too early
  - `failed_optout` — Ivan asked to be removed
  - `failed_ignored` — Ivan stopped replying for 3+ turns
  - `failed_stage` — a stage timed out without enough engagement
- At the end: a debrief overlay shows product-fit review, the cover reveal with full product card, transition naturalness, key moments, archetype reveal, and an exemplar bridge.
- Trainee downloads the HTML report from the debrief overlay. **v5: the report is cached client-side the moment the debrief completes, so the download works even if the server has evicted the session in the meantime.**

## Facilitator access

All three require `ADMIN_TOKEN` set in the environment and passed as `?token=...`:

- `/facilitator?token=...` — cheatsheet: archetypes, 5 covers with probe/pitch signals, recovery rules, run sheet. Toolbar at top: Print · Printable layout · Fact sheet pack · Session log.
- `/facilitator/printable?token=...` — same content, print-optimised serif layout, auto-opens print dialog.
- `/facilitator/factsheets?token=...` — all 5 cover fact sheets in one printable page.
- `/api/admin/log?token=...` — HTML list of every session currently in memory (200-session ring buffer).
- `/api/admin/log.json?token=...` — raw JSON for debugging.

Per-cover fact sheets are available publicly at `/api/factsheet/:coverKey.html` (no token required — these are product briefs, not internal coaching).

---

## The 5 covers

All non-VHIS. One is assigned as Ivan's true fit each session.

| Cover | Category | What's on Ivan's mind if this is his true cover |
|---|---|---|
| Starter Protection | Medical — public-healthcare gap | Mum's gallbladder surgery; a colleague's dengue + HKD 18k in self-financed drugs |
| Critical Shield | Critical illness | Uncle's stage-2 cancer; grandpa's heart attack at 58; Ivan's borderline cholesterol |
| Active Guard | Personal accident + sports | Rolled ankle 3 weeks ago, HKD 4,800 out of pocket; group medical's "off-duty" exclusion |
| Income Continuity | Disability income | Monthly transfer to mum; 2.5-month runway; colleague's 5-month burnout leave |
| Smart Start Saver | Savings-linked | HKD 60k sitting idle; failed three times to build a saving habit |

Each cover has selling points, trade-offs, optional promotional bundles, and a "why superior vs alternatives" line (see `src/covers.js`). These render as printable fact sheets at `/api/factsheet/:coverKey.html`.

---

## What changed in v5

### Validation layer — reinforced

v4 had regex grounding + LLM grounding with one regeneration pass. v5 adds two new layers that run BEFORE the LLM validator:

**Anti-repetition (`src/validator.js: antiRepetitionCheck`)**

Hashes Ivan's proposed reply against the last 3 Ivan replies in the conversation. Jaccard similarity on stopword-filtered content tokens. Flags at threshold 0.70, also catches verbatim repetition. This was the v4 bug where Ivan would repeat his scam-suspicion line verbatim in two consecutive turns — now caught and regenerated.

**Wild-claim (`src/validator.js: wildClaimCheck`)**

Six pattern families:
- Invented competitor brand (FWD, AIA, Manulife, AXA, Prudential, China Life, Bupa, Cigna, Blue Cross)
- Invented regulator approval (SEC approved / IA licensed / HKMA certified)
- Invented percentage claim (e.g. "100% payout")
- Invented absolute claim (guaranteed / lifetime / unlimited coverage)
- Invented scope claim ("covers everything")
- Invented specific HKD amount (3+ digits)

Two guard rails reduce false positives:
- Question-vs-assertion segmentation: "does it cover everything?" (Ivan asking skeptically) is NOT flagged; "it covers everything" (Ivan asserting an unstated fact) IS flagged.
- Seller-corpus grandfathering: if the seller said "FWD" earlier, Ivan can reference FWD without flag.

All four validator layers now run in order: regex grounding → anti-repetition → wild-claim → LLM grounding. First failure triggers the one regeneration pass with a tightening instruction.

### Fact sheets

New `src/factsheet.js` renders polished printable HTML fact sheets per cover and a combined pack. Each fact sheet has:
- Masthead (eyebrow, cover name, tagline, category pill)
- "Who this is for" callout (the 1:1 need label + summary)
- Key features (selling points)
- Why this vs alternatives (blue-box callout)
- Trade-offs (amber-box callout)
- Optional bundles, each labelled as promotional add-on
- Print button + @media print CSS

Routes:
- `/api/factsheet/:coverKey.html` — individual fact sheet (public)
- `/facilitator/factsheets?token=...` — all 5 in one printable page

### Trainer cheat sheet — now actually usable

The v4 `/facilitator` route existed but had a weak markdown renderer and returned bare `401 Unauthorized` / `503 Disabled` with no instructions. v5 fixes:

- Clear 401/503 gate pages that tell the visitor exactly how to get access (`?token=YOUR_ADMIN_TOKEN`)
- Full markdown renderer: headings, ordered + unordered lists, code blocks, tables (pipe syntax), horizontal rules, inline code, bold, italic, links — the original cheatsheet now renders with all its tables formatted properly
- Toolbar at the top of every cheatsheet page: Print · Printable layout · Fact sheet pack · Session log
- `/facilitator/printable?token=...` — stripped-down serif layout that auto-opens the print dialog

### Frontend robustness

**HTML download always works.** The v4 "File wasn't available on site" bug was caused by the client hitting `/api/session/report.html?sessionId=...` at download-click time — if the session had been evicted from the 200-session in-memory ring buffer, the server returned 404.

v5 fix: the client prefetches the HTML at the moment the debrief completes and caches it in memory. `downloadLog()` creates a Blob from that cache and triggers download via `URL.createObjectURL` — no live server round-trip needed. If the server prefetch fails, the client builds a functional fallback report from its own state (`buildFallbackReportHtml`).

**"Something went wrong" toast — tighter logic.** v4 showed the alarming generic error on ANY non-2xx response. v5 categorizes:

| Status | Message |
|---|---|
| 200 with bad JSON | "Received an unexpected response. Press Send again to retry." |
| 429 | "Too many messages too fast — wait a few seconds." |
| 4xx (other) | "Your session may have expired. Please refresh and start again." |
| 5xx / network | "Something went wrong on the server. Try again." |
| Downstream exception in response handler | "Hmm, something glitched on my end. Try sending that again." |

All five paths reverse the turn (remove the user's bubble, restore the input text, pop the last history entry) so a retry is clean. Plus a `turnInFlight` guard to prevent double-submit.

**Error boundaries on debrief rendering.** Each section in `showDebriefOverlay` is wrapped in its own try/catch via `makeSection()`. A failing section shows a small "(this section failed to render)" note; the rest of the debrief renders normally. If the entire debrief explodes, `renderMinimalDebriefActions()` still shows a download button — the user never loses access to their report.

### Multi-player / concurrency

Single-process Node architecture. Sessions are stored in an in-memory Map keyed by sessionId, capped at 200. Reads and writes scoped strictly per session ID. No cross-process contamination possible. Test Case 10 in the test suite verifies two concurrent sessions remain isolated (9 assertions).

Caveat: if you ever scale to more than one Railway instance, the in-memory Map doesn't span processes. Either enable Railway sticky-session routing or swap in persistent storage. Single-instance deploys (the default) are fine.

---

## Test coverage

`npm test` runs 10 scenarios with 156 assertions, offline, no API calls:

| # | Case | Assertions |
|---|---|---|
| 1 | Exit intent terminates conversation | 22 |
| 2 | Source challenge doesn't advance stage | 3 |
| 3 | Hallucinated offer blocked by validator | 6 |
| 4 | Multi-turn revealed-facts tracking | 2 |
| 5 | Insurance mapping: 5-cover schema | 72 |
| 6 (v5) | Anti-repetition catches verbatim + near-duplicate | 5 |
| 7 (v5) | Wild-claim detection | 7 |
| 8 (v5) | Fact sheet rendering across all 5 covers | 32 |
| 9 (v5) | Error categorization contract | 7 |
| 10 (v5) | Session isolation between concurrent players | 9 |

All pass. Expected output: `RESULTS: 156 passed, 0 failed`.

---

## Cost (DeepSeek-V3.2)

Per turn:
- Persona call: ~$0.001
- Anti-repetition + wild-claim + regex grounding: free (all synchronous)
- LLM validator: ~$0.0005 when it fires (replies ≥15 words or when earlier layers flagged)
- Regeneration on validator failure: adds ~$0.001
- Optional breach judge: ~$0.0005 when triggered

End-of-session (parallel judges): ~$0.005

Workshop of 30 trainees × ~30 turns ≈ USD $3–5.

---

## File map

```
server.js                            — Express app, routes, orchestration
src/
  personas.js                        — Base Ivan + 4 archetypes + grounding rules
  covers.js                          — 5-cover catalog with schema validation
  prompts.js                         — Prompt assembly + disclosure mechanic
  breaches.js                        — Regex patterns incl. exit-intent
  stateMachine.js                    — Session states + recovery logic
  validator.js                       — regex grounding + anti-repetition + wild-claim + LLM grounding
  factsheet.js                       — NEW: per-cover HTML fact sheets
  judges.js                          — LLM judges for end-of-session debrief
  scoring.js                         — Per-turn 1-10 score
  audit.js                           — In-memory session log
  logExport.js                       — HTML session reports
public/
  index.html                         — Shell
  app.js                             — Frontend: defensive response handling, cached downloads, error boundaries
  styles.css                         — Styles
docs/
  FACILITATOR_CHEATSHEET.md          — Cheatsheet source (rendered via /facilitator)
tests/
  scenarios.mjs                      — 156 offline assertions across 10 scenarios
```

---

## Known limits

- Audit log is in-memory. Railway restart mid-workshop = lost data. Fine for the facilitator HTML export if you pull it before the restart.
- The anti-repetition check uses a 0.70 Jaccard threshold. If your workshops see legitimate Ivan replies being flagged (e.g. short replies with few content words that happen to overlap), lower the threshold in `src/validator.js`.
- The wild-claim regex is narrow by design — it catches the common DeepSeek failure modes but not all possible hallucinations. The LLM validator is the catch-all; it runs on any reply ≥15 words.
- Pitch classification is regex-based. Creative phrasings that dodge canonical product terms may classify as `generic`. The need-discovery judge at debrief provides an LLM-based second opinion that isn't regex-constrained.
- 20 combos × workshop scale: not every trainee will see every combo. The facilitator cheatsheet describes all 5 covers so any session can be debriefed meaningfully.
