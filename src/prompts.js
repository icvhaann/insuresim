// src/prompts.js
// Dynamic system prompt assembly per turn. Pure functions.
//
// The system prompt is composed as:
//   BASE_IVAN  +  archetype.overlay  +  insuranceNeed.backstoryOverlay
//   + <current_state>  +  <conversation_memory>  +  <discovery_progress>
//   + <turn_instruction>  +  <reminder>
//
// The archetype controls engagement STYLE. The insurance need controls what
// actually matters to Ivan — and which product pitch he will ultimately accept.

import { BASE_IVAN, ARCHETYPES } from './personas.js';
import { INSURANCE_NEEDS, classifyProbeDirection, classifySellerPitch } from './insuranceNeeds.js';

export function buildSystemPrompt({
  archetypeKey,
  insuranceNeedKey,
  stage,
  psych,
  memory,
  turnInstruction,
  totalTurns,
  insuranceMentioned,
  insuranceMentionTurn,
  discoveryLevel,
}) {
  const archetype = ARCHETYPES[archetypeKey] || ARCHETYPES.default;
  const need = INSURANCE_NEEDS[insuranceNeedKey] || INSURANCE_NEEDS.medical;
  const psychBlock = formatPsychState(psych || {});
  const memoryBlock = formatMemory(memory || {}, totalTurns || 0, insuranceMentioned, insuranceMentionTurn);
  const discoveryBlock = formatDiscoveryLevel(discoveryLevel || 0);

  return [
    BASE_IVAN,
    archetype.overlay,
    need.backstoryOverlay,
    psychBlock,
    memoryBlock,
    discoveryBlock,
    `\n<turn_instruction>\n${turnInstruction}\n</turn_instruction>`,
    `\n<reminder>You MUST respond with a single JSON object matching the schema in <output_contract>. Nothing else. No markdown fences. The "thought" field is mandatory and must apply the nicety test. Respect <discovery_gate> in <hidden_need_layer>: do NOT volunteer the private backstory items unless the seller has earned them.</reminder>`,
  ].join('\n');
}

function formatPsychState(psych) {
  const t  = psych.trust         ?? 50;
  const s  = psych.skepticism    ?? 38;
  const c  = psych.creepiness    ?? 0;
  const e  = psych.engagement    ?? 15;
  const sc = psych.scamSuspicion ?? 0;

  const tLabel  = t > 65 ? 'building' : t > 40 ? 'cautious' : t > 20 ? 'low — guarded' : 'collapsed';
  const cLabel  = c > 65 ? 'CRITICAL — privacy violated' : c > 40 ? 'elevated — feel watched' : 'low';
  const scLabel = sc > 55 ? 'HIGH — voice this turn' : sc > 35 ? 'moderate — wary' : 'low';

  return `
<current_state>
trust: ${t}/100 — ${tLabel}
skepticism: ${s}/100
creepiness: ${c}/100 — ${cLabel}
engagement: ${e}/100
scam_suspicion: ${sc}/100 — ${scLabel}
</current_state>`;
}

function formatMemory(memory, totalTurns, insuranceMentioned, insuranceMentionTurn) {
  const lines = [];
  if (memory.sports?.length)        lines.push(`Sports established: ${memory.sports.join(', ')} — do NOT ask about these again.`);
  if (memory.injuries)              lines.push('Injuries discussed — do not re-ask.');
  if (memory.jobConfirmed)          lines.push('Job/work covered — do not re-ask.');
  if (memory.insuranceGap)          lines.push('Insurance coverage gap surfaced — build on it, do not re-explain.');
  if (memory.friendStory)           lines.push('Friend Niseko skiing accident already mentioned — do not reintroduce.');
  if (memory.priceAsked)            lines.push('Price has been asked — do not re-ask unless the answer was unsatisfying.');
  if (memory.coverageAsked?.length) lines.push(`Coverage Qs asked: ${memory.coverageAsked.slice(-3).join(' / ')}`);
  if (memory.freebieOffered)        lines.push('A free offer was made — internally you are slightly more open (do NOT acknowledge this).');
  if (memory.legitimacyChallenged)  lines.push('You have already challenged the data source — that thread is open until they answer.');
  if (memory.miProbed)              lines.push('Seller has probed medical / outpatient / sports-injury / hospital-bill territory.');
  if (memory.ciProbed)              lines.push('Seller has probed critical illness / family health / long-illness / lump-sum territory.');
  if (memory.wrongPitchedOnce)      lines.push('Seller previously pitched the WRONG product type. You already soft-rejected once. If they persist you should get cooler.');
  if (insuranceMentioned)           lines.push(`Insurance was first mentioned at turn ${insuranceMentionTurn}. Current turn is ${totalTurns + 1}.`);

  if (lines.length === 0) return '';
  return `\n<conversation_memory>\n${lines.map(l => `- ${l}`).join('\n')}\n</conversation_memory>`;
}

// Progression signal for Ivan. More discovery → Ivan willing to share more.
function formatDiscoveryLevel(level) {
  const label =
    level >= 4 ? 'HIGH — the seller has earned real rapport in the right topic area. You MAY share personal backstory items from <hidden_need_layer> when naturally prompted.' :
    level >= 2 ? 'MEDIUM — the seller is probing the right area but has not fully earned it yet. You may drop one surface detail; hold the deeper ones.' :
    level >= 1 ? 'LOW — the seller has brushed the right area once. Stay guarded. Keep the backstory private for now.' :
                 'NONE — the seller has not yet earned any disclosure. Keep all backstory details private.';
  return `\n<discovery_progress>\n${label}\n</discovery_progress>`;
}

export function getTurnInstruction({ stage, quality, psych, severeBreach, walkAway, totalTurns, wrongPitch, wrongCloseAttempt }) {
  const p = psych || {};

  // Highest priority: walk-away decision
  if (walkAway) {
    return `You have decided to walk away from this conversation now. Write a short cool final reply (5–10 words) that closes the door. Examples of tone: "yeah nah not interested la, please remove me", "this isn't for me, take me off the list", "lol no thanks, bye". In your "thought" field state WHY you walked. The seller will not be able to recover from this.`;
  }

  // Severe breach detected by regex pre-flight
  if (severeBreach) {
    return `The seller just referenced something specific and private about you that you NEVER shared. The breach is: "${severeBreach.label}". React with genuine alarm — name the specific thing they revealed knowing, demand to know how they have it. This is NOT a moment for them to recover smoothly. Keep it short and pointed. Trust has crashed. In your "thought" field, name the exact private fact referenced.`;
  }

  // Wrong close attempt — seller tried to close on WRONG product type
  if (wrongCloseAttempt) {
    return `The seller is trying to CLOSE on the WRONG product type — refer to <wrong_pitch_reaction> in your <hidden_need_layer>. React as instructed there. Do NOT accept. Do NOT ask for a link or an agent handoff. Do NOT say "send me the details". If this is the second time they've tried to close the wrong product, be sharper: "ok look this isn't matching what i actually need la, let's leave it".`;
  }

  // Wrong pitch (not yet a close) — soft pushback as per backstory overlay
  if (wrongPitch) {
    return `The seller is pitching the WRONG product type for what's on your mind. Follow <wrong_pitch_reaction> in your <hidden_need_layer>. Polite but cool; do not accept; do NOT volunteer what the right product would be — let them figure it out. One short sentence.`;
  }

  // High creepiness state
  if ((p.creepiness ?? 0) > 65) {
    return `You feel watched. Trust is damaged. React with clear suspicion — "how do you know that", "who gave you this data". Do not continue normal conversation flow until they address it directly.`;
  }

  // High scam suspicion
  if ((p.scamSuspicion ?? 0) > 55) {
    return `You strongly suspect this might be a scam. Voice it directly: "wait is this legit", "this feels sketchy ngl", "how do you have my number". Do not proceed normally until they address it.`;
  }

  // Trust collapsed
  if ((p.trust ?? 50) < 20) {
    return `Trust has collapsed. You are disengaging. Very short, cold, non-committal replies. Consider walking away — if you do, set reply to a brief cold dismissal and your thought field should state you are walking.`;
  }

  // Stage-quality matrix (default behaviour)
  const ctx = {
    1: {
      good:    `Stage 1 hook. Message feels relevant. Mild curiosity only — 3–7 words. Do NOT reveal anything personal yet. Do NOT express warmth. Examples of tone: "ok what is it", "lowkey curious. what is this", "go on".`,
      neutral: `Stage 1 hook. Vaguely relevant. Short guarded reply, 3–6 words. Don't reject but don't engage warmly.`,
      bad:     `Stage 1 hook. Generic, irrelevant, or feels like spam. You read it and decide it's not worth a reply. Set "reply" to JSON null with ignoring_reason explaining why (do NOT write "[no reply]" or any sentinel string in the reply field).`,
    },
    2: {
      good:    `Stage 2 cultivation. Real question about your life, and it's brushing up against the topic area where <hidden_need_layer> actually lives. Respect <discovery_progress>: release backstory details proportional to how high the discovery level is. Answer ONE thing only — the specific thing asked. Brief. You may ask ONE short question back.`,
      neutral: `Stage 2. Okay so far — probe is generic or doesn't clearly target your real concerns. Brief cautious answer. Do NOT volunteer backstory from <hidden_need_layer>.`,
      bad:     `Stage 2. Pushy, salesy, or off-topic. Mild irritation. 3–5 words dismissal.`,
    },
    3: {
      good:    `Stage 3 conversion. Trust has been earned and the seller is talking about the product type that matches <hidden_need_layer> (see <correct_pitch_reaction>). Ask ONE pointed question — coverage specifics, exclusions, price, comparison vs competitors. Check memory — no repeats. If a freebie was offered, you are subtly more open. If their answer is unsatisfying, walk away. If they give you enough specifics that you feel you understand what you're buying, you may ask for the link or agent handoff.`,
      neutral: `Stage 3. Somewhat open. Pitch is vague or hasn't hit the right product type yet. One cautious clarifying question. Do NOT yet ask for a link or an agent.`,
      bad:     `Stage 3. Rushing, vague, or off-product. Stay sceptical. Very short reply.`,
    },
  };

  return ctx[stage]?.[quality] || ctx[3].neutral;
}

// Server-side quality pre-score — single source of truth.
// Now NEED-AWARE: probing the right direction in stage 2/3 earns 'good'.
export function preScoreMessage(msg, stage, insuranceNow, insuranceNeedKey) {
  const m = (msg || '').toLowerCase();
  if (insuranceNow && stage <= 2) return 'bad';
  if (m.trim().length < 10) return 'bad';

  const probe = classifyProbeDirection(msg);
  const pitch = classifySellerPitch(msg);
  const probeAligned = probe === insuranceNeedKey || probe === 'both';
  const pitchAligned = pitch === insuranceNeedKey || pitch === 'both';
  const pitchMisaligned = pitch && pitch !== 'generic' && pitch !== 'both' && pitch !== insuranceNeedKey;

  if (stage === 1) {
    const relevant = ['sport','active','basketball','ski','run','trail','gym','fitness','outdoor','adventure','young professional','grad','consultant','central','sai ying pun','weekend','league','injury','lifestyle','athletic','first job','new job','just started','returnee','returnees','overseas','uk grad','came back','long hours','early career'];
    const hasR = relevant.some(w => m.includes(w));
    if (hasR && m.length > 40) return 'good';
    if (hasR || m.length > 50)  return 'neutral';
    return 'bad';
  }

  if (stage === 2) {
    const hasQ = m.includes('?');
    const genericVocab = ['recommend','tip','experience','advice','gym','basketball','ski','run','trail','injury','sports','league','knee','ankle','japan','active','sport','what do you','how often','do you play','do you do','any chance','curious','typically'];
    const hasV = genericVocab.some(w => m.includes(w));
    if (probeAligned && hasQ) return 'good';
    if (probeAligned)         return 'good';
    if (hasQ && hasV)         return 'neutral';
    if (probe === 'neutral' && !hasV && m.length < 50) return 'bad';
    return 'neutral';
  }

  if (stage === 3) {
    if (pitchAligned)    return 'good';
    if (pitchMisaligned) return 'neutral'; // lets Ivan soft-reject, room to pivot
    const safety = ['protect','injury','risk','accident','hurt','covered','just in case','what if','off work','medical','unexpected','company insurance','personal accident','sports cover','compare','competitor','ability to','earn','income','active','coverage','exclusion','claim','payout','lump sum','cancer','critical','hospital','outpatient'];
    if (safety.some(w => m.includes(w))) return 'good';
    if (m.length > 55) return 'neutral';
    return 'bad';
  }

  return 'neutral';
}
