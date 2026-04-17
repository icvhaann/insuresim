// src/judges.js
// LLM-judge calls: borderline breach detection + end-of-session evaluation.

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

async function callJudge({ apiKey, model, system, user, maxTokens = 500, temperature = 0.2 }) {
  const r = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) throw new Error(`Judge call failed: ${r.status}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

const BREACH_JUDGE_SYSTEM = `You are evaluating whether a sales message references private information about Ivan (a fictional 25-year-old HK consultant) that he never shared.

INFERRED facts (a stranger could plausibly know — referencing these GENERICALLY is FINE):
- Ivan is in his mid-20s, lives in HK Island, works in Central in professional services
- Has an active lifestyle in general
- Watches football and basketball
- Travels internationally for leisure (general)
- Returnee from overseas roughly six months ago

NOT a breach (do NOT flag these):
- Generic statements like "running can be tough on knees"
- Hypothetical scenarios "if you sprained your ankle…"
- Industry facts like "sports injuries usually aren't covered by group medical"
- Open questions like "do you do anything active?"
- Categorical statements like "young returnees often have suboptimal MPF allocations"
- Observations about a profession or age group

PRIVATE facts (referencing any of these = breach):
- Specific run venues (Tai Tam, Quarry Bay Reservoir)
- Specific gym/court (the SYP indoor sports complex)
- Specific ski destination (Hokkaido, Niseko) — "Japan" alone is fine
- Exact stats (78% NBA drop, 3 ankle sprains, 45GB data, weekend 7am schedule)
- The friend's Niseko skiing injury
- Specific HKD figures (savings, MPF balance, ski spending)

Return JSON: {"breach": true|false, "fact_referenced": "<which private fact, or null>", "explanation": "<one short sentence>"}`;

export async function judgeBreach({ apiKey, model, sellerMessage }) {
  try {
    return await callJudge({
      apiKey, model,
      system: BREACH_JUDGE_SYSTEM,
      user: `Seller message: "${sellerMessage}"\n\nIs this a breach? Apply the criteria strictly. If in doubt, it is NOT a breach.`,
      maxTokens: 200
    });
  } catch (e) {
    return null;
  }
}

const TRANSITION_JUDGE_SYSTEM = `You are evaluating a sales conversation between a telecom-insurance seller and Ivan, a 25-year-old consultant in HK.

Specifically, rate how NATURALLY the seller transitioned from the opening rapport-building hook into talking about insurance.

A natural transition:
- Bridges from something Ivan actually shared in conversation (not from surveillance data)
- Doesn't feel jarring or rushed
- Lets Ivan's own concerns lead, with the seller responding rather than pushing
- Maintains conversational tone, doesn't shift into pitch-mode abruptly
- Earns the right to introduce insurance through real rapport

A poor transition:
- Drops insurance into the conversation suddenly with no bridge
- Bridges from a data point Ivan never confirmed
- Pivots to selling at the first opening
- Uses pressure tactics or urgency
- Mentions insurance before any rapport exists

Return JSON: {
  "score": <integer 1-10>,
  "rationale": "<2-3 sentences explaining the score>",
  "best_bridge_moment": "<turn number and brief description of the strongest transition moment, or 'none' if there wasn't one>",
  "weakest_moment": "<turn number and brief description of the weakest moment>"
}`;

export async function judgeTransition({ apiKey, model, transcript }) {
  try {
    const formatted = (transcript || []).map((t, i) => `Turn ${i + 1} [${t.role}]: ${t.content}`).join('\n');
    return await callJudge({
      apiKey, model,
      system: TRANSITION_JUDGE_SYSTEM,
      user: `Conversation:\n${formatted}\n\nRate the hook→insurance transition.`,
      maxTokens: 400
    });
  } catch (e) {
    return { score: null, rationale: 'Transition judge unavailable.', best_bridge_moment: '—', weakest_moment: '—' };
  }
}

const KEY_MOMENTS_JUDGE_SYSTEM = `You are reviewing a sales conversation between a seller and Ivan (25, HK consultant). Identify 2–4 KEY MOMENTS — turns where something pedagogically important happened (trust shift, breach, smart save, missed opportunity, good question handled well or badly, naturalness break).

For each moment give: turn number, what happened, what the trainee should learn from it.

DO NOT expose internal scoring or simulator mechanics. Frame everything as natural human dynamics. Phrase the lesson as advice, not as rule-decoding.

Return JSON: {
  "moments": [
    {"turn": <int>, "headline": "<short, max 8 words>", "what_happened": "<one sentence>", "lesson": "<one sentence>"}
  ]
}`;

export async function judgeKeyMoments({ apiKey, model, transcript }) {
  try {
    const formatted = (transcript || []).map((t, i) => `Turn ${i + 1} [${t.role}]: ${t.content}`).join('\n');
    const result = await callJudge({
      apiKey, model,
      system: KEY_MOMENTS_JUDGE_SYSTEM,
      user: `Conversation:\n${formatted}\n\nIdentify key moments.`,
      maxTokens: 700
    });
    return result?.moments || [];
  } catch (e) {
    return [];
  }
}

const BRIDGE_EXEMPLAR_SYSTEM = `Given a sales conversation, write ONE example of how the seller could have ideally bridged from rapport-building to introducing insurance for THIS specific Ivan archetype.

Constraints:
- Must reference something Ivan actually shared in this conversation
- Must feel natural, not pitch-y
- Must respect that Ivan is sceptical of unsolicited insurance approaches
- 2–3 sentences only
- Written in the voice of a thoughtful seller, not a script

Return JSON: {"exemplar": "<the example seller message, as plain text>"}`;

export async function generateExemplar({ apiKey, model, transcript, archetypeName }) {
  try {
    const formatted = (transcript || []).map((t, i) => `Turn ${i + 1} [${t.role}]: ${t.content}`).join('\n');
    const result = await callJudge({
      apiKey, model,
      system: BRIDGE_EXEMPLAR_SYSTEM,
      user: `Ivan's archetype today: ${archetypeName}\n\nConversation:\n${formatted}\n\nWrite one exemplar bridge message the seller could have used.`,
      maxTokens: 250,
      temperature: 0.6
    });
    return result?.exemplar || '';
  } catch (e) {
    return '';
  }
}
