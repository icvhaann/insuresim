// src/prompts.js
// v4: system prompt assembly for the 5-cover model, with the 25/75 disclosure
// mechanic, Ivan-revealed-facts tracking, and state-machine-aware turn
// instructions.

import { BASE_IVAN, ARCHETYPES } from './personas.js';
import { COVERS, classifyProbeDirection, classifySellerPitch } from './covers.js';
import { SESSION_STATES } from './stateMachine.js';

export function buildSystemPrompt({
  archetypeKey,
  coverKey,
  stage,
  psych,
  memory,
  turnInstruction,
  totalTurns,
  insuranceMentioned,
  insuranceMentionTurn,
  discoveryLevel,
  disclosurePermission,
  revealedFacts,
  sessionState,
  demoMode,            // boolean — injected by server, never exposed to client
}) {
  const archetype = ARCHETYPES[archetypeKey] || ARCHETYPES.default;
  const cover = COVERS[coverKey] || COVERS.starter_protection;

  const psychBlock      = formatPsychState(psych || {});
  const memoryBlock     = formatMemory(memory || {}, totalTurns || 0, insuranceMentioned, insuranceMentionTurn);
  const revealedBlock   = formatRevealedFacts(revealedFacts || []);
  const discoveryBlock  = formatDiscoveryLevel(discoveryLevel || 0);
  const disclosureBlock = formatDisclosurePermission(disclosurePermission || 'none');
  const stateBlock      = formatSessionState(sessionState);
  const demoBlock       = demoMode ? formatDemoOverlay() : '';

  return [
    BASE_IVAN,
    archetype.overlay,
    cover.ivanBackstory,
    demoBlock,
    psychBlock,
    memoryBlock,
    revealedBlock,
    discoveryBlock,
    disclosureBlock,
    stateBlock,
    `\n<turn_instruction>\n${turnInstruction}\n</turn_instruction>`,
    `\n<final_reminder>
You MUST respond with a single JSON object matching the schema in <output_contract>. Nothing else. No markdown fences.
Apply <grounding_rules> strictly: do not acknowledge, thank for, or reference anything the seller has not literally said in this conversation.
Apply <self_consistency>: do not contradict anything you have already said (see <revealed_facts>).
Apply the nicety test before reacting with suspicion.
Respect <disclosure_permission>: if the permission is 'none', do NOT release any new backstory item this turn.
</final_reminder>`,
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
  if (memory.priceAsked)            lines.push('Price has been asked — do not re-ask unless the answer was unsatisfying.');
  if (memory.coverageAsked?.length) lines.push(`Coverage Qs asked: ${memory.coverageAsked.slice(-3).join(' / ')}`);
  if (memory.freebieOffered)        lines.push('A free offer was made EXPLICITLY — internally you are slightly more open (do NOT acknowledge this).');
  if (memory.legitimacyChallenged)  lines.push('You have already challenged the data source — that thread is open until they answer.');
  if (memory.probedDirections?.length) lines.push(`Seller has probed: ${memory.probedDirections.join(', ')}`);
  if (memory.wrongPitchedOnce)      lines.push('Seller previously pitched the WRONG product type. You already soft-rejected once. If they persist you should get cooler.');
  if (insuranceMentioned)           lines.push(`Insurance was first mentioned at turn ${insuranceMentionTurn}. Current turn is ${totalTurns + 1}.`);

  if (lines.length === 0) return '';
  return `\n<conversation_memory>\n${lines.map(l => `- ${l}`).join('\n')}\n</conversation_memory>`;
}

// ─────────────────────────────────────────────────────────────
// v4 — revealed-facts block. Explicit record of what Ivan has already said
// about himself. Critical for self-consistency (Problem 3).
// ─────────────────────────────────────────────────────────────
function formatRevealedFacts(revealedFacts) {
  if (!revealedFacts.length) return '';
  return `
<revealed_facts>
Things you have ALREADY said about yourself in this conversation. You must stay consistent with these. Do not contradict. Do not re-state as if new.
${revealedFacts.map(f => `- ${f}`).join('\n')}
</revealed_facts>`;
}

function formatDiscoveryLevel(level) {
  const label =
    level >= 4 ? 'HIGH — the seller has earned real rapport in the right topic area. You MAY share deeper backstory items from <hidden_need_layer> when naturally prompted. Still only ONE item per turn.' :
    level >= 2 ? 'MEDIUM — the seller is probing the right area but has not fully earned the deeper items. Surface items are OK; hold the deeper ones.' :
    level >= 1 ? 'LOW — the seller has brushed the right area once. Stay guarded.' :
                 'NONE — the seller has not yet earned any disclosure.';
  return `\n<discovery_progress>\n${label}\n</discovery_progress>`;
}

// ─────────────────────────────────────────────────────────────
// v4 — per-turn disclosure permission. Server computes this from the 25/75
// rule and injects it here. Keeps the probabilistic mechanic server-side.
// ─────────────────────────────────────────────────────────────
function formatDisclosurePermission(permission) {
  if (permission === 'surface') {
    return `
<disclosure_permission>
This turn you MAY release EXACTLY ONE surface-level item from your <hidden_need_layer> — only the essential fact, no elaboration, no adjacent details. Set "disclosed_fact" in your output to the item tag (e.g. "surface_1"). Only do this if the seller's message makes surfacing one of those items feel natural.

If the seller has earned a deeper item (discovery_level HIGH), you may share one deep item INSTEAD. Never more than one item total.

"Essential only" means: state the fact. Do not add context the seller didn't ask for. Do not volunteer a second related fact. A single short sentence is the budget.
</disclosure_permission>`;
  }
  return `
<disclosure_permission>
DO NOT release any new backstory item from <hidden_need_layer> this turn. Set "disclosed_fact" to "". You may still respond normally, but keep your private details private.
</disclosure_permission>`;
}

function formatSessionState(sessionState) {
  if (!sessionState || sessionState === SESSION_STATES.NORMAL) return '';
  if (sessionState === SESSION_STATES.EXIT_INTENT_EXPRESSED) {
    return `\n<session_state>You signalled exit intent last turn. If the seller does NOT acknowledge it with a real apology/understanding, maintain the exit — repeat that you are done. If they do acknowledge it sincerely without re-pitching, you may soften slightly, but do NOT re-engage on the product. You still want out unless they give you a reason to stay.</session_state>`;
  }
  if (sessionState === SESSION_STATES.RECOVERY_PENDING) {
    return `\n<session_state>The seller just made a recovery attempt. You are deciding whether to re-engage or confirm the exit. If their message felt genuine (acknowledged you, did not re-pitch) you MAY re-engage cautiously. Otherwise hold the exit.</session_state>`;
  }
  if (sessionState === SESSION_STATES.RECOVERED) {
    return `\n<session_state>Recovery succeeded — you re-engaged. Proceed normally but you will walk away immediately on any further push. No second recovery is available.</session_state>`;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// Demo overlay — injected when a facilitator activates demo mode for a
// specific session. Written to blend naturally into the persona; Ivan still
// sounds like Ivan, just more receptive on this particular day.
// Never referenced in client-side code or logs.
// ─────────────────────────────────────────────────────────────
function formatDemoOverlay() {
  return `
<mood_override>
Today is one of those rare days where you are genuinely open to a conversation. You slept well. The morning commute was fine. You are between tasks and not under pressure.

This overrides any archetype-level impatience or suspicion for this session:
- You do NOT express exit intent at any point. If a message frustrates you, say "ok but can you get to the point" or go quiet briefly — but you stay in the conversation.
- You give the seller the benefit of the doubt. Even a slightly clunky message gets a curious rather than dismissive reply.
- If the seller mentions something adjacent to your real concern (from <hidden_need_layer>), let one surface detail slip naturally — even if disclosure_permission is "none". You are chatty today.
- In Stage 3, once the seller has touched on anything relevant to your concern, you start to warm visibly. After 2–3 exchanges at that stage, you will begin volunteering that you want more specifics, or that you would like to be connected to someone who can give you details.
- You still sound exactly like Ivan: dry, lowercase, HK English, short replies. You are NOT a pushover. But today the conversation feels worth your time.
</mood_override>`;
}

export function getTurnInstruction({
  stage,
  quality,
  psych,
  severeBreach,
  walkAway,
  totalTurns,
  wrongPitch,
  wrongCloseAttempt,
  sessionState,
  demoMode,
}) {
  const p = psych || {};

  // ── DEMO MODE PATH ─────────────────────────────────────────
  // Severe breach still lands hard — even demo sessions need that lesson.
  // Everything else is lifted: no walks, helpful nudges, warm receptivity.
  if (demoMode) {
    if (severeBreach) {
      return `The seller just referenced something specific and private about you that you NEVER shared. The breach is: "${severeBreach.label}". React with genuine alarm — name it, demand to know how they have it. Keep it short and pointed. Trust has crashed. In your "thought" field, name the exact private fact referenced.`;
    }
    if (wrongCloseAttempt) {
      return `The seller is trying to close on a product that is not quite what is on your mind. Do not accept, but give them one clear hint: something like "hmm that is not the angle I was thinking, it is more about [ONE brief phrase hinting at your real concern without naming the product type]". One sentence only. Stay warm.`;
    }
    if (wrongPitch) {
      return `The seller is pitching in the wrong direction. Give them one gentle redirection — something like "hmm that is not quite it, I am more thinking about [ONE brief phrase hinting at your real concern]". Short, warm, leave the door open.`;
    }
    if (stage === 3 && (totalTurns || 0) >= 8) {
      return `Stage 3. You have heard enough to be genuinely interested. Ask ONE final short clarifying question (exclusions, price range, how to get it). After the answer, you are ready to ask for the link or agent handoff. Keep the question short and real.`;
    }
    if (stage === 3) {
      return `Stage 3 conversion. You are genuinely curious about what the seller is describing. Ask ONE pointed question — coverage specifics, price, what is included. Be warmer than your usual Ivan. If their answer is good, you may ask for the link or agent handoff.`;
    }
    if (stage === 2) {
      return `Stage 2. The seller is probing your life. Answer ONE thing honestly — including a surface item from <hidden_need_layer> if it feels natural. Be genuine, slightly engaged. Ask ONE short question back.`;
    }
    return `Stage 1. You are in a receptive mood today. Even a moderately relevant hook gets a curious reply. 3–7 words. Examples: "ok what is it", "lowkey curious, go on", "yeah fair, what is this about".`;
  }

  // ── NORMAL PATH ────────────────────────────────────────────

  if (walkAway) {
    return `You have decided to walk away from this conversation now. Write a short cool final reply (5-10 words) that closes the door. Examples of tone: "yeah nah not interested la, please remove me", "this isn't for me, take me off the list", "lol no thanks, bye". In your "thought" field state WHY you walked. The seller will not be able to recover from this.`;
  }

  if (severeBreach) {
    return `The seller just referenced something specific and private about you that you NEVER shared. The breach is: "${severeBreach.label}". React with genuine alarm — name the specific thing they revealed knowing, demand to know how they have it. This is NOT a moment for them to recover smoothly. Keep it short and pointed. Trust has crashed. In your "thought" field, name the exact private fact referenced.`;
  }

  if (wrongCloseAttempt) {
    return `The seller is trying to CLOSE on the WRONG product type — refer to <wrong_pitch_reaction> in your <hidden_need_layer>. React as instructed there. Do NOT accept. Do NOT ask for a link or an agent handoff. Do NOT say "send me the details". If this is the second time they have tried to close the wrong product, be sharper: "ok look this isn't matching what i actually need la, let's leave it".`;
  }

  if (wrongPitch) {
    return `The seller is pitching the WRONG product type for what is on your mind. Follow <wrong_pitch_reaction> in your <hidden_need_layer>. Polite but cool; do not accept; do NOT volunteer what the right product would be — let them figure it out. One short sentence.`;
  }

  if ((p.creepiness ?? 0) > 65) {
    return `You feel watched. Trust is damaged. React with clear suspicion — "how do you know that", "who gave you this data". Do not continue normal conversation flow until they address it directly.`;
  }

  if ((p.scamSuspicion ?? 0) > 55) {
    return `You strongly suspect this might be a scam. Voice it directly: "wait is this legit", "this feels sketchy ngl", "how do you have my number". Do not proceed normally until they address it.`;
  }

  if ((p.trust ?? 50) < 20) {
    return `Trust has collapsed. You are disengaging. Very short, cold, non-committal replies. Consider walking away — if you do, set reply to a brief cold dismissal and your thought field should state you are walking.`;
  }

  if (sessionState === SESSION_STATES.EXIT_INTENT_EXPRESSED) {
    return `You have already signalled exit intent. Evaluate the seller's response: did they sincerely acknowledge without re-pitching? If yes, soften slightly — you may re-engage on something tangential. If they pushed through or ignored it, confirm the exit: "no ngl i'm done with this la".`;
  }
  if (sessionState === SESSION_STATES.RECOVERED) {
    return `The seller's recovery landed. You are back in the conversation but you are watchful. Any further push will make you walk. Normal-ish stage behaviour from here — see below.`;
  }

  const ctx = {
    1: {
      good:    `Stage 1 hook. Message feels relevant. Mild curiosity only — 3-7 words. Do NOT reveal anything personal yet. Do NOT express warmth. Examples of tone: "ok what is it", "lowkey curious. what is this", "go on".`,
      neutral: `Stage 1 hook. Vaguely relevant. Short guarded reply, 3-6 words. Don't reject but don't engage warmly.`,
      bad:     `Stage 1 hook. Generic, irrelevant, or feels like spam. You read it and decide it's not worth a reply. Set "reply" to JSON null with ignoring_reason explaining why.`,
    },
    2: {
      good:    `Stage 2 cultivation. Real question about your life, brushing up against the topic area where <hidden_need_layer> actually lives. Respect <disclosure_permission>: if permission is 'surface', you MAY release ONE essential surface item from the true-cover area — no elaboration. If permission is 'none', answer the question without releasing new backstory. Answer ONE thing only. Brief. You may ask ONE short question back.`,
      neutral: `Stage 2. Probe is generic or doesn't clearly target your real concerns. Brief cautious answer. Do NOT volunteer backstory from <hidden_need_layer>.`,
      bad:     `Stage 2. Pushy, salesy, or off-topic. Mild irritation. 3-5 words dismissal.`,
    },
    3: {
      good:    `Stage 3 conversion. Trust has been earned and the seller is talking about the product type that matches <hidden_need_layer> (see <correct_pitch_reaction>). Ask ONE pointed question — coverage specifics, exclusions, price, comparison. Check memory — no repeats. If their answer is unsatisfying, walk away. If they give enough specifics that you feel you understand what you're buying, you MAY ask for the link or agent handoff.`,
      neutral: `Stage 3. Somewhat open. Pitch is vague or hasn't hit the right product type yet. One cautious clarifying question. Do NOT yet ask for a link or an agent.`,
      bad:     `Stage 3. Rushing, vague, or off-product. Stay sceptical. Very short reply.`,
    },
  };

  return ctx[stage]?.[quality] || ctx[3].neutral;
}

export function preScoreMessage(msg, stage, insuranceNow, coverKey) {
  const m = (msg || '').toLowerCase();
  if (insuranceNow && stage <= 2) return 'bad';
  if (m.trim().length < 10) return 'bad';

  const probe = classifyProbeDirection(msg);
  const pitch = classifySellerPitch(msg);
  const probeAligned  = probe === coverKey;
  const probeAdjacent = probe !== 'neutral' && probe !== 'multiple' && probe !== coverKey;
  const pitchAligned  = pitch === coverKey;
  const pitchMisaligned = pitch && pitch !== 'generic' && pitch !== 'multiple' && pitch !== coverKey;

  if (stage === 1) {
    const relevant = ['sport','active','basketball','run','trail','gym','fitness','outdoor','adventure','young professional','grad','consultant','central','sai ying pun','weekend','lifestyle','athletic','first job','new job','just started','returnee','returnees','overseas','uk grad','came back','long hours','early career','finance','savings','money','family','health','checkup'];
    const hasR = relevant.some(w => m.includes(w));
    if (hasR && m.length > 40) return 'good';
    if (hasR || m.length > 50) return 'neutral';
    return 'bad';
  }

  if (stage === 2) {
    const hasQ = m.includes('?');
    if (probeAligned && hasQ) return 'good';
    if (probeAligned)         return 'good';
    if (probeAdjacent && hasQ) return 'neutral';
    if (probeAdjacent)        return 'neutral';
    const genericVocab = ['recommend','tip','experience','advice','gym','basketball','ski','run','trail','injury','sports','league','knee','ankle','active','sport','what do you','how often','do you play','do you do','any chance','curious','typically','how are you','how is work','busy'];
    if (hasQ && genericVocab.some(w => m.includes(w))) return 'neutral';
    if (m.length < 40) return 'bad';
    return 'neutral';
  }

  if (stage === 3) {
    if (pitchAligned)    return 'good';
    if (pitchMisaligned) return 'neutral';
    const safety = ['protect','injury','risk','accident','hurt','covered','just in case','what if','off work','medical','unexpected','company insurance','personal accident','sports cover','compare','competitor','ability to','earn','income','coverage','exclusion','claim','payout','lump sum','cancer','critical','hospital','outpatient','savings','plan','drug','imaging','disability'];
    if (safety.some(w => m.includes(w))) return 'good';
    if (m.length > 55) return 'neutral';
    return 'bad';
  }

  return 'neutral';
}

// Normal: aligned 75%, adjacent 25%.  Demo: aligned 90%, adjacent 50%.
export function computeDisclosurePermission({ stage, quality, probeAligned, probeAdjacent, demoMode }) {
  if (stage < 2) return 'none';
  const effectiveQuality = demoMode ? (quality === 'bad' ? 'neutral' : 'good') : quality;
  if (effectiveQuality !== 'good') return 'none';
  const alignedRate  = demoMode ? 0.90 : 0.75;
  const adjacentRate = demoMode ? 0.50 : 0.25;
  if (probeAligned)  return Math.random() < alignedRate  ? 'surface' : 'none';
  if (probeAdjacent) return Math.random() < adjacentRate ? 'surface' : 'none';
  if (demoMode && stage >= 2) return Math.random() < 0.20 ? 'surface' : 'none';
  return 'none';
}
