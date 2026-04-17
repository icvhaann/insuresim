# InsureSim v2

Internal sales-training simulator. Workshop tool for sellers learning to bridge from a personalised hook into an insurance pitch with a HK consumer persona ("Ivan C.").

This is v2 — a refactor of the original. Key changes summarised at the end.

---

## Quick deploy (Railway)

1. `git push` this directory to a new repo.
2. New Railway project → deploy from repo.
3. Environment variables (Settings → Variables):
   - `DEEPSEEK_API_KEY` — required.
   - `DEEPSEEK_MODEL` — optional. Defaults to `deepseek-chat` (DeepSeek-V3.2). Don't use `deepseek-reasoner` here — JSON mode behaves worse with the thinking model.
   - `ADMIN_TOKEN` — required if you want to use the facilitator log export. Generate a long random string.
4. Railway picks up `npm start` automatically.
5. After each workshop: rotate the DeepSeek API key.

## Local

```
cp .env.example .env          # fill in DEEPSEEK_API_KEY
npm install
npm start                     # http://localhost:3000
```

---

## Workshop flow

- Trainee opens the URL, hits **Start Session**.
- The simulator picks one of four personas at random (hidden until debrief).
- Three stages: Hook → Cultivate → Convert.
- Each stage has min turns / max turns / score thresholds. Falling below means stage failure. Crossing the threshold advances.
- Win condition: Ivan asks to be connected with an agent or to receive details.
- Lose conditions: Ivan walks away, opts out, or stops responding for three turns.
- At the end: a debrief overlay shows scorecard, transition naturalness score, key moments, the persona reveal, and a suggested bridge example.
- Trainee downloads a JSON log from the debrief overlay and hands it to the facilitator.

## Facilitator log export

If `ADMIN_TOKEN` is set, the facilitator can export the full audit log of all sessions on the box:

```
GET /api/admin/log?token=YOUR_ADMIN_TOKEN
```

Returns JSON of every session held in memory (capped at 200 most recent, cleared on restart).

---

## What changed vs v1

| Area | v1 | v2 |
|---|---|---|
| Prompt assembly | Client-side, sent in plaintext | Server-side, never exposed to client |
| Persona | One Ivan | Four archetypes (Burned, Default, Slammed, Warm-but-wary) randomly assigned |
| Output | Raw text, sometimes returned `[ignored message]` literal | JSON contract `{thought, reply, ignoring_reason}` with sentinel-string filter |
| Privacy taxonomy | Implicit | Explicit three-bucket: inferred-OK / not-a-breach-even-though-specific / private |
| Hallucination guard | None | "Nicety test" — Ivan must internally name the specific private fact before reacting suspiciously |
| Breach detection | Regex only | Regex first-pass + LLM judge for borderline cases (parallel call) |
| Insurance walk-away | Hard binary cutoff at turns 1–2 | Probability curve `0.90 × exp(-0.35 × (turn-1))`, modulated by trust |
| Walk-away presentation | Always overlay | 50/50 between cold-reply-then-overlay or overlay-only |
| Severe breach reaction | Canned alarm pool of ~10 lines | Model-generated, instructed via high-priority turn directive |
| Ivan's depth | Thin backstory | Specific frustrations, things he genuinely wants advice on, texture details |
| In-session coaching | Tip box, stage hints | Removed entirely — feedback only at debrief |
| Sidebar | Always open | Collapsed by default (data must be deliberately accessed) |
| Score display | Cumulative only | Stage average (large) + cumulative (small) + per-stage history |
| Debrief | None | Outcome banner, scorecard, transition naturalness (LLM judge 1-10), key moments (LLM judge), persona reveal, exemplar bridge |
| Download log button | Header, always visible | Hidden during play, appears in debrief overlay only |
| XSS surface | innerHTML in many places | textContent everywhere |
| Cheat codes | Bypassed AI to force outcomes | Removed |
| Rate limit | Broken behind Railway proxy | Fixed (`trust proxy: 1`) |
| Audit log | None | In-memory ring buffer, 200-session cap, facilitator export endpoint |

---

## Cost (DeepSeek-V3.2)

Roughly $0.001–0.002 per turn (persona + occasional judge). End-of-session adds ~$0.003 (transition + key-moments + exemplar judges run in parallel). A full workshop of 30 trainees × ~30 turns per session is around USD $1–2.

---

## Dry-run all four archetypes before the workshop

The four personas behave differently enough that the facilitator should walk through one session of each before the trainees arrive. Roughly:

- **Default**: a baseline run. Polite hook → relevant cultivation → soft pitch should advance through all three stages.
- **Burned**: any unsolicited tone gets a "is this a scam" within 2–3 turns. A free-trial offer makes things worse, not better. The trainee has to address legitimacy honestly to recover.
- **Slammed**: 1–3 word replies most turns. The trainee needs to be brutally concise and directly relevant or Ivan walks. Long messages get "tldr".
- **Warm-but-wary**: easy to get warmth in stages 1–2. But any privacy breach lands ~1.3× harder than for other archetypes — the contrast amplifies the reaction.

Each session randomly assigns one of the four; you may need 6–10 sessions before you see all four.

---

## File map

```
server.js              — Express app, endpoints, model orchestration
src/personas.js        — Base Ivan + 4 archetypes + privacy taxonomy
src/prompts.js         — System prompt assembly, turn instruction, pre-scoring
src/breaches.js        — Regex patterns, walk-away probability function
src/judges.js          — LLM judge calls (breach, transition, key moments, exemplar)
src/scoring.js         — Per-turn 1-10 score
src/audit.js           — In-memory session log
public/index.html      — Shell
public/app.js          — Frontend logic (state, UI, HTTP)
public/styles.css      — Styles
```

---

## Known limits / things to revisit

- The simulator's framing — that telco data can be openly used to pitch insurance based on inferred behavioural patterns — is a workshop construct. In real deployment under HK PDPO Part 6A and IA GL25 disclosure rules, much of this would require explicit consent and disclosure. This is intentional for training friction; it is not a model for production sales practice.
- Audit log is in-memory only. If Railway restarts the container mid-workshop, history is lost. For persistent storage, swap `src/audit.js` to a file or DB.
- DeepSeek model behaviour is the bottleneck on persona realism. If the persona feels stiff, trying `gpt-4o` or `claude-sonnet` for the persona call (keeping DeepSeek for cheap judge calls) is the next step.
- The LLM judge for breach detection fires only when regex misses but the message is long and contains private-adjacent terms. It is not run on every turn for cost reasons. Tune the trigger condition in `server.js` if false-negatives appear.
