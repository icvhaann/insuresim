// src/scoring.js
// Per-turn 1-10 score based on (seller message, Ivan reply, stage, signals, alignment).
// Used both for the running stage average and for the debrief scorecard.

const DISMISSED = ['not interested','no thanks','remove me','pass','not worth it','fine with my current','does not fit','i am out','gonna pass','wrong number','ok bye','k bye','take me off','please stop'];
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
  else if (!ivanReply) score = 2;                                   // ignored
  else                 score = 4 + Math.floor(Math.random() * 2);   // 4-5

  if (quality === 'good') score = Math.min(10, score + 1);
  if (quality === 'bad')  score = Math.max(1, score - 2);

  // Breach penalties
  if (signals?.severeBreach)         score = Math.max(1, score - 4);
  if (signals?.privateRefs?.length)  score = Math.max(1, score - 2);
  if (signals?.confirmingQ?.length)  score = Math.max(1, score - 1);

  // Insurance-need alignment signals (Stage 2+)
  // alignment.probeDirection:  'medical' | 'critical_illness' | 'both' | 'neutral'
  // alignment.pitchType:       'medical' | 'critical_illness' | 'both' | 'generic' | null
  // alignment.needKey:         'medical' | 'critical_illness'
  if (alignment && stage >= 2) {
    const { probeDirection, pitchType, needKey } = alignment;
    const probeAligned = probeDirection === needKey || probeDirection === 'both';
    const pitchAligned = pitchType === needKey || pitchType === 'both';
    const pitchMis    = pitchType && pitchType !== 'generic' && pitchType !== 'both' && pitchType !== needKey;

    if (stage === 2 && probeAligned)  score = Math.min(10, score + 1);
    if (stage === 3 && pitchAligned)  score = Math.min(10, score + 1);
    if (stage === 3 && pitchMis)      score = Math.max(1, score - 1);
    if (alignment.wrongClose)         score = Math.max(1, score - 3); // tried to close wrong product
  }

  return Math.max(1, Math.min(10, score));
}
