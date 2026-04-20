// src/validator.js
//
// v4 grounding validator. Two layers:
//
//   1. REGEX PRE-FILTER (free, synchronous):
//      Catches the most common hallucination patterns — Ivan referring to
//      offers/prices/features that were never stated in the conversation. If
//      flagged, we either regenerate OR rewrite post-hoc (cheaper).
//
//   2. LLM VALIDATOR (per-turn, parallel with persona call when possible):
//      A second model call that reads the conversation history + Ivan's reply,
//      and returns {grounded: bool, issue: string} with a strict JSON schema.
//      Fires only when the reply is long enough to plausibly hallucinate
//      (≥ 15 words) OR when the regex layer already flagged something.
//
// On validation failure we attempt ONE regeneration pass with a tightening
// instruction. If that also fails, we fall back to a "safe" short reply so the
// session keeps moving.

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─────────────────────────────────────────────────────────────
// Regex pre-filter. Cheap, synchronous. Patterns that frequently indicate
// hallucinated content — unless the corresponding pattern exists in the
// conversation log.
// ─────────────────────────────────────────────────────────────
const HALLUCINATION_CHECKS = [
  {
    // Ivan acknowledging a free trial
    re: /\b(the\s+)?free\s*(trial|month|first\s*month|cover)|(?:thanks|thx|nice|ok)\s*(?:for\s*)?(?:the\s*)?(?:free|complimentary|no.?cost)/i,
    kind: 'free_offer_ack',
    requiresInSellerMessages: /\b(free\s*(trial|month|first\s*month|cover|consultation)|complimentary|no\s*(cost|charge|fee)|on\s*us|waive(d)?)\b/i,
    description: 'Ivan acknowledged a free offer that was never made by the seller',
  },
  {
    // Ivan quoting a specific HKD amount the seller never mentioned
    re: /\b(hkd?|hk\$)\s*\d{2,}|\bdollars?\s*\d{2,}|\b\d{2,}\s*(a|per)\s*(month|year)\b/i,
    kind: 'specific_price_ack',
    requiresInSellerMessages: /\b(hkd?|hk\$)\s*\d{2,}|\$\s*\d{2,}|\bdollars?\s*\d{2,}|\b\d+\s*(per|a|\/)\s*(month|year|week)\b/i,
    description: 'Ivan quoted a specific price that was never stated by the seller',
  },
  {
    // Ivan thanking for a discount that was never mentioned
    re: /\bthanks?\s*for\s*the\s*(discount|offer|deal|rebate)|nice\s*discount/i,
    kind: 'discount_ack',
    requiresInSellerMessages: /\b(discount|rebate|off|%\s*off|cashback|cash\s*back|deal|offer\s*of\s*\d)/i,
    description: 'Ivan acknowledged a discount that was never offered',
  },
  {
    // Ivan accepting a link / URL / phone number that wasn't sent
    re: /\b(got|received)\s*(the|your)\s*(link|url|number)|(?:i'?ll|i\s*will)\s*(click|visit|check)\s*(the|that)\s*link/i,
    kind: 'link_ack',
    requiresInSellerMessages: /\bhttps?:\/\/|www\.|\.com\b|\.hk\b|phone.{0,5}\d|\bring\s*\d|\+852/i,
    description: 'Ivan acknowledged a link/URL/phone that was never sent',
  },
  {
    // Ivan attributing a specific plan name that was never stated
    re: /\b(starter\s*protection|critical\s*shield|active\s*guard|income\s*continuity|smart\s*start\s*saver)\b/i,
    kind: 'product_name_ack',
    requiresInSellerMessages: /\b(starter\s*protection|critical\s*shield|active\s*guard|income\s*continuity|smart\s*start\s*saver)\b/i,
    description: 'Ivan referenced a specific plan name that was never stated by the seller',
  },
];

// Stitch all seller messages together (including the latest one) for check.
function sellerCorpus(conversationHistory, latestSellerMsg) {
  const parts = [latestSellerMsg || ''];
  for (const m of conversationHistory || []) {
    if (m.role === 'user' || m.role === 'seller') parts.push(m.content || '');
  }
  return parts.join(' | ');
}

export function regexGroundingCheck(ivanReply, conversationHistory, latestSellerMsg) {
  if (!ivanReply || typeof ivanReply !== 'string') return { ok: true, issues: [] };
  const corpus = sellerCorpus(conversationHistory, latestSellerMsg);
  const issues = [];
  for (const chk of HALLUCINATION_CHECKS) {
    if (chk.re.test(ivanReply)) {
      if (!chk.requiresInSellerMessages.test(corpus)) {
        issues.push({ kind: chk.kind, description: chk.description });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────
// LLM validator. Parallelism is tricky — the reply must exist first. So this
// is called AFTER the persona response arrives. Total per-turn latency becomes
// ~ 2× persona latency in the worst case.
//
// To keep cost down, only fire the LLM validator when:
//   (a) the regex layer flagged something, OR
//   (b) Ivan's reply is ≥ 15 words (longer replies have more hallucination surface)
// ─────────────────────────────────────────────────────────────

const VALIDATOR_SYSTEM_PROMPT = `You are a strict grounding checker for a sales-training simulator.

You will receive:
  1. The conversation history (what the seller and Ivan have actually said).
  2. Ivan's latest proposed reply.

Your job: decide whether Ivan's reply violates grounding rules.

Grounding violations include:
  - Ivan acknowledges, thanks for, or asks about an offer (free trial, free month, discount, rebate, bonus) that the seller NEVER stated in the conversation.
  - Ivan cites a specific price, premium, or HKD amount that the seller NEVER stated.
  - Ivan references a specific plan name, URL, phone number, agent name, or product feature that the seller NEVER stated.
  - Ivan contradicts something he himself said earlier in the conversation (for example, claims he plays basketball in one turn and then that he doesn't do sports in another).

NOT grounding violations:
  - Ivan having a personality, tone, or an internal reaction — that's his persona, not grounding.
  - Ivan asking a new question or making a guarded comment.
  - Ivan referring to his own life (job, location, activities) in ways he hasn't yet stated — his backstory is real, he may choose to surface NEW true details; the rule is only that he cannot invent seller-side facts or contradict himself.
  - Ivan declining or showing scepticism.

IMPORTANT: be conservative. Only flag a CLEAR and SPECIFIC violation. If in doubt, mark it grounded.

Return strict JSON, nothing else:
{
  "grounded": true | false,
  "issue_kind": "free_offer_ack" | "specific_price_ack" | "product_feature_ack" | "self_contradiction" | "other" | null,
  "issue_description": "<one short sentence if not grounded, empty string otherwise>",
  "problematic_phrase": "<the exact quoted fragment that caused the flag, empty string if grounded>"
}`;

export async function llmGroundingCheck({ apiKey, model, conversationHistory, latestSellerMsg, ivanReply }) {
  if (!ivanReply) return { ok: true };
  const conversation = (conversationHistory || [])
    .map((m, i) => {
      const role = m.role === 'assistant' ? 'IVAN' : 'SELLER';
      return `[${i + 1}] ${role}: ${m.content}`;
    })
    .join('\n');

  const userContent =
    `CONVERSATION SO FAR:\n${conversation}\n\nSELLER (latest, just sent): ${latestSellerMsg}\n\nIVAN'S PROPOSED REPLY: ${ivanReply}\n\nIs the proposed reply grounded?`;

  try {
    const r = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 200,
        temperature: 0.0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) return { ok: true, skipped: true, reason: `validator http ${r.status}` };
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    if (!parsed) return { ok: true, skipped: true, reason: 'validator parse failure' };
    if (parsed.grounded === false) {
      return {
        ok: false,
        issue: {
          kind: parsed.issue_kind || 'other',
          description: parsed.issue_description || 'Validator flagged a grounding issue',
          phrase: parsed.problematic_phrase || '',
        },
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: true, skipped: true, reason: e.message };
  }
}

// Word count helper — used to decide whether to fire LLM validator.
export function wordCount(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

// Should we fire the LLM validator for this reply?
export function shouldValidateLLM(ivanReply, regexIssuesFound) {
  if (!ivanReply) return false;
  if (regexIssuesFound > 0) return true;
  return wordCount(ivanReply) >= 15;
}
