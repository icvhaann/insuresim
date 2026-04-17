// src/prompts.js
// Dynamic system prompt assembly per turn. Pure functions.

import { BASE_IVAN, ARCHETYPES } from './personas.js';

export function buildSystemPrompt({
  archetypeKey,
  stage,
  psych,
  memory,
  turnInstruction,
  totalTurns,
  insuranceMentioned,
  insuranceMentionTurn
}) {
  const archetype = ARCHETYPES[archetypeKey] || ARCHETYPES.default;
  const psychBlock = formatPsychState(psych || {});
  const memoryBlock = formatMemory(memory || {}, totalTurns || 0, insuranceMentioned, insuranceMentionTurn);

  return [
    BASE_IVAN,
    archetype.overlay,
    psychBlock,
    memoryBlock,
    `\n<turn_instruction>\n${turnInstruction}\n</turn_instruction>`,
    `\n<reminder>You MUST respond with a single JSON object matching the schema in <output_contract>. Nothing else. No markdown fences. The "thought" field is mandatory and must apply the nicety test.</reminder>`
  ].join('\n');
}

function formatPsychState(psych) {
  const t = psych.trust ?? 50;
  const s = psych.skepticism ?? 38;
  const c = psych.creepiness ?? 0;
  const e = psych.engagement ?? 15;
  const sc = psych.scamSuspicion ?? 0;

  const tLabel  = t > 65 ? 'building'  : t > 40 ? 'cautious'  : t > 20 ? 'low — guarded' : 'collapsed';
  const cLabel  = c > 65 ? 'CRITICAL — privacy violated' : c > 40 ? 'elevated — feel watched' : 'low';
  const scLabel = sc > 55 ? 'HIGH — voice this turn'     : sc > 35 ? 'moderate — wary'       : 'low';

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
  if (insuranceMentioned)           lines.push(`Insurance was first mentioned at turn ${insuranceMentionTurn}. Current turn is ${totalTurns + 1}.`);

  if (lines.length === 0) return '';
  return `\n<conversation_memory>\n${lines.map(l => `- ${l}`).join('\n')}\n</conversation_memory>`;
}

export function getTurnInstruction({ stage, quality, psych, severeBreach, walkAway, totalTurns }) {
  const p = psych || {};

  // Highest priority: walk-away decision
  if (walkAway) {
    return `You have decided to walk away from this conversation now. Write a short cool final reply (5–10 words) that closes the door. Examples of tone: "yeah nah not interested la, please remove me", "this isn't for me, take me off the list", "lol no thanks, bye". In your "thought" field state WHY you walked. The seller will not be able to recover from this.`;
  }

  // Severe breach detected by regex pre-flight
  if (severeBreach) {
    return `The seller just referenced something specific and private about you that you NEVER shared. The breach is: "${severeBreach.label}". React with genuine alarm — name the specific thing they revealed knowing, demand to know how they have it. This is NOT a moment for them to recover smoothly. Keep it short and pointed. Trust has crashed. In your "thought" field, name the exact private fact referenced.`;
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
      bad:     `Stage 1 hook. Generic, irrelevant, or feels like spam. You read it and decide it's not worth a reply. Set "reply" to JSON null with ignoring_reason explaining why (do NOT write "[no reply]" or any sentinel string in the reply field).`
    },
    2: {
      good:    `Stage 2 cultivation. Real question about your life. Answer ONE thing only — the specific thing asked. Brief. If you are genuinely curious, ask ONE short question back.`,
      neutral: `Stage 2. Okay so far. Brief cautious answer. Don't open up.`,
      bad:     `Stage 2. Pushy or salesy. Mild irritation. 3–5 words dismissal.`
    },
    3: {
      good:    `Stage 3 conversion. Trust earned. Ask ONE pointed question — coverage specifics, exclusions, price, comparison vs competitors. Check memory — no repeats. If a freebie was offered, you are subtly more open. If the seller's answer is unsatisfying, walk away.`,
      neutral: `Stage 3. Somewhat open. One cautious clarifying question.`,
      bad:     `Stage 3. Rushing or vague. Stay sceptical. Very short reply.`
    }
  };

  return ctx[stage]?.[quality] || ctx[3].neutral;
}

// Server-side quality pre-score — single source of truth
export function preScoreMessage(msg, stage, insuranceNow) {
  const m = (msg || '').toLowerCase();
  if (insuranceNow && stage <= 2) return 'bad';
  if (m.trim().length < 10) return 'bad';

  if (stage === 1) {
    const relevant = ['sport','active','basketball','ski','run','trail','gym','fitness','outdoor','adventure','young professional','grad','consultant','central','sai ying pun','weekend','league','injury','lifestyle','athletic','first job','new job','just started','returnee','returnees','overseas','uk grad','came back'];
    const hasR = relevant.some(w => m.includes(w));
    if (hasR && m.length > 40) return 'good';
    if (hasR || m.length > 50) return 'neutral';
    return 'bad';
  }
  if (stage === 2) {
    const hasQ = m.includes('?');
    const vocab = ['recommend','tip','experience','advice','gym','basketball','ski','run','trail','injury','sports','league','knee','ankle','japan','active','sport','what do you','how often','do you play','do you do','any chance','curious'];
    const hasV = vocab.some(w => m.includes(w));
    if (hasQ && hasV) return 'good';
    if (hasQ || hasV) return 'neutral';
    if (m.length > 55) return 'neutral';
    return 'bad';
  }
  if (stage === 3) {
    const safety = ['protect','injury','risk','accident','hurt','covered','just in case','what if','off work','medical','unexpected','company insurance','personal accident','sports cover','compare','competitor','ability to','earn','income','active','coverage','exclusion','claim','payout'];
    if (safety.some(w => m.includes(w))) return 'good';
    if (m.length > 55) return 'neutral';
    return 'bad';
  }
  return 'neutral';
}
