// src/scoring.js
// Per-turn 1-10 score. v4 updates: alignment factor now cover-specific rather
// than 2-need binary.

const DISMISSED = ['not interested','no thanks','remove me','pass','not worth it','fine with my current','does not fit','i am out','gonna pass','wrong number','ok bye','k bye','take me off','please stop','leave it'];
const ENGAGED   = ['interesting','how','what kind','ok and','and?','what is it','go on','lowkey','ngl','fair','actually','not bad','what were','i will bite','curious','hmm','tell me'];
const CURIOUS   = ['what does it cover','sounds relevant','how much','what if i','cover','send me','actually makes sense','compare','competitor','excluded','does it cover','that is wild','so if i','fair point','wait fr','ok ngl','that actually'];

export function scoreTurn({ userMsg, ivanReply, stage, quality, signals, alignment }) {
  const lower = (ivanReply || '').toLowerCase();
  const isDismissed = DISMISSED.some(w => lower.includes(w));
  const isEngaged   = ENGAGED.some(w => lower.includes(w));
  const isCurious   = CURIOUS.some(w => lower.includes(w));

  let score;
  if (isDismissed)     score = 1 + Math.floor(Math.random() * 2);   // 1-2
  else if (isCurious)  score = 8 + Math.floor(Math.random() * 2);   // 8-9
  else if (isEngaged)  score = 5 + Math.floor(Math.random() * 3);   // 5-7
  else if (!ivanReply) score = 2;
  else                 score = 4 + Math.floor(Math.random() * 2);   // 4-5

  // Quality modifier (stage-specific pre-score, now cover-aware)
  if (quality === 'good') score = Math.min(10, score + 1);
  if (quality === 'bad')  score = Math.max(1, score - 2);

  // Privacy penalties
  if (signals?.severeBreach)         score = Math.max(1, score - 4);
  if (signals?.privateRefs?.length)  score = Math.max(1, score - 2);
  if (signals?.confirmingQ?.length)  score = Math.max(1, score - 1);

  // Alignment modifiers (cover-specific)
  if (alignment) {
    // Stage 3: wrong-cover pitch penalty (non-fatal)
    if (stage === 3 && alignment.pitchMisaligned) score = Math.max(1, score - 2);
    // Stage 3: wrong-cover close attempt — heavier penalty
    if (alignment.wrongClose) score = Math.max(1, score - 3);
    // Stage 2: probed the right cover's topic area — small bonus on top of quality
    if (stage === 2 && alignment.probeAligned) score = Math.min(10, score + 1);
  }

  return Math.max(1, Math.min(10, score));
}
