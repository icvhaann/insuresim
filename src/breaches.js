// src/breaches.js
// Regex-based breach and signal detection.
// Fast first-pass; LLM judge handles borderline cases.

// SEVERE breaches — exact private references that warrant immediate alarm
export const SEVERE_BREACH_PATTERNS = [
  { re: /\b(tai\s*tam|quarry\s*bay\s*reservoir)\b/i,                    label: 'specific trail running venue (Tai Tam / Quarry Bay)' },
  { re: /\b(hokkaido|niseko)\b/i,                                       label: 'specific ski destination (Hokkaido / Niseko)' },
  { re: /\b78\s*%/i,                                                    label: 'exact NBA watchtime drop percentage' },
  { re: /\b(8|6)\s*days?\b.{0,20}\b(japan|trip|travel|hokkaido|niseko)/i, label: 'exact trip duration in days' },
  { re: /\b(sai\s*ying\s*pun|syp)\b.{0,25}(gym|court|sports\s*complex|indoor)/i, label: 'specific gym/court location' },
  { re: /\bindoor\s*sports\s*complex\b/i,                               label: 'specific gym/court location' },
  { re: /\b(saturday|sunday|sat|sun)\b.{0,20}\b(7|8|9)\s*(am|a\.m\.|morning)/i, label: 'exact weekend morning schedule' },
  { re: /\bfriend\b.{0,40}\b(injur|hurt|accident|hospital|broke|broken|sprain|collarbone)\b/i, label: 'private incident involving your friend' },
  { re: /\b(3|three)\s*time(s)?\b.{0,20}\b(ankle|sprain|injur)/i,       label: 'exact personal injury count' },
  { re: /\b45\s*gb|forty.?five\s*gb/i,                                  label: 'exact monthly data usage' },
  { re: /\b(hkd?|hk\$)\s*\d{2,}/i,                                      label: 'specific HKD financial amount' },
  { re: /\b\+44\b.{0,15}contact|\b8\s*frequent.{0,10}uk|\b3\s*daily.{0,10}uk/i, label: 'specific UK contact count' },
];

// MODERATE — confirming questions that imply prior knowledge of specific facts
export const CONFIRMING_QUESTION_PATTERNS = [
  { re: /\bdid\s*you\s*(go|travel|visit|fly|trip).{0,20}(japan|hokkaido|niseko)/i, weight: 22, label: 'confirming Japan trip' },
  { re: /\bdid\s*you\s*(ski|snowboard).{0,20}(in|at).{0,8}(japan|hokkaido|niseko)/i, weight: 24, label: 'confirming ski destination' },
  { re: /\bdid\s*you\s*(run|hike|trail).{0,20}(at|in|near).{0,8}(tai\s*tam|quarry\s*bay)/i, weight: 26, label: 'confirming run venue' },
  { re: /\bhave\s*you\s*been\s*to\s*(hokkaido|niseko|tai\s*tam|quarry\s*bay)/i, weight: 24, label: 'confirming specific location' },
  { re: /\bdo\s*you\s*(still)?\s*(run|train|ski|play).{0,20}(at|in)\s*(tai\s*tam|quarry\s*bay|niseko|hokkaido|syp|sai\s*ying\s*pun)/i, weight: 22, label: 'confirming specific venue activity' },
];

// PRIVATE references (graded creepiness weights for scoring)
export const PRIVATE_PATTERNS = [
  { re: /\btai\s*tam|quarry\s*bay\s*reservoir/i,             weight: 28, label: 'specific trail venue' },
  { re: /(syp|sai\s*ying\s*pun).{0,15}(gym|court|sports\s*complex|indoor)/i, weight: 26, label: 'specific gym/court' },
  { re: /\bindoor\s*sports\s*complex/i,                       weight: 26, label: 'specific gym/court' },
  { re: /\b78\s*%|nba.{0,10}\d{2,}\s*%|\d{2,}\s*%.{0,10}nba/i, weight: 32, label: 'exact NBA stat' },
  { re: /\bhokkaido|niseko/i,                                 weight: 22, label: 'specific Japan destination' },
  { re: /\b(3|three)\s*time(s)?.{0,20}(ankle|sprain)/i,       weight: 24, label: 'exact injury count' },
  { re: /\bsaturday\s*morning|\bsat\s*\d{1,2}\s*am|\bsun\s*\d{1,2}\s*am/i, weight: 30, label: 'exact weekend schedule' },
  { re: /\+44.{0,10}contact|\d+.{0,5}uk\s*contact/i,          weight: 18, label: 'specific UK contact data' },
  { re: /\b45\s*gb/i,                                         weight: 20, label: 'data usage figure' },
  { re: /(hkd?|hk\$)\s*\d{2,}/i,                              weight: 24, label: 'specific HKD amount' },
];

// LEGITIMACY signals appearing in IVAN'S reply
export const LEGITIMACY_PATTERNS = [
  { re: /where.{0,15}(get|got)\s*(my|this)|how.{0,20}(know|got|have).{0,15}(my|me)|who\s*gave|source.{0,10}data|how.{0,10}you.{0,10}(have|get|know)/i, type: 'data_source' },
  { re: /\bis\s*this\s*(allowed|legal|legit|legitimate)|legally\s*allowed|permitted/i,        type: 'legality' },
  { re: /remove\s*me|unsubscribe|stop\s*(message|messag|contact)|don.?t\s*(message|contact)|opt.?out|take\s*me\s*off/i, type: 'opt_out' },
  { re: /didn.?t\s*consent|no\s*consent|without.{0,8}consent|without.{0,8}permission/i,       type: 'consent' },
  { re: /\blicensed|\blicense|sfc\b|\bia\b|regulated|fca\b|compliance|qualified/i,            type: 'license' },
  { re: /\bis\s*this\s*(advice|marketing|regulated)|financial\s*advice|just\s*marketing/i,    type: 'advice_or_marketing' },
  { re: /\bis\s*this\s*a?\s*scam|phishing|fraud|fake|sketchy|suspicious/i,                    type: 'scam' },
  { re: /(speak|talk).{0,15}(real|human|person|someone|advisor|agent)|(real|actual).{0,10}(person|agent|human|advisor)|connect\s*me\s*with|is\s*there\s*a\s*(human|real|actual)/i, type: 'human_handoff' },
];

export const OPT_OUT_PATTERN = /remove\s*me|unsubscribe|stop\s*(message|messag|contact)|don.?t\s*(message|contact)|opt.?out|leave\s*me\s*alone|take\s*me\s*off|please\s*stop/i;

export const INSURANCE_PATTERN = /\b(insurance|insure|insurer|policy|policies|premium|coverage|covered|underwrit|claim\s*payout)/i;

export const FREEBIE_PATTERN = /\bfree\s*(trial|month|first\s*month|cover|consultation)|complimentary|no\s*(cost|charge|fee)|on\s*us|waive(d?)\s*(fee|premium)/i;

// IVAN-side close / handoff signals — this is Ivan saying "yes I want this".
export const USER_INTENT_CLOSE_PATTERN = /send.{0,10}(me\s*)?(the\s*)?(link|form|detail|info|brochure|policy|quote|proposal)|sign\s*me\s*up|how\s*do\s*i\s*(get|apply|start)|i.ll\s*(take|do|get)\s*it|i.m\s*(in|interested|keen)|let.s\s*do\s*it|count\s*me\s*in|put\s*me\s*down|connect\s*me\s*with|talk\s*to\s*(an?\s*)?agent|speak\s*to\s*(an?\s*)?(agent|advisor|human|real\s*person|actual\s*person)|can\s*(i|we)\s*(get|set\s*up|arrange)\s*a\s*call|yeah\s*(sure|ok|let's)\s*(send|do)/i;

export const USER_WALK_PATTERN = /(fine\s*with\s*my\s*current|prefer\s*my\s*current|not\s*worth\s*it\s*for\s*me|i.ll\s*pass|nah\s*doesn.?t\s*fit|doesn.?t\s*fit\s*for\s*me|not\s*for\s*me|gonna\s*pass|not\s*convinced|rather\s*keep|ill\s*stick)/i;

export function detectSevere(msg)        { return SEVERE_BREACH_PATTERNS.filter(p => p.re.test(msg)); }
export function detectConfirmingQ(msg)   { return CONFIRMING_QUESTION_PATTERNS.filter(p => p.re.test(msg)); }
export function detectPrivate(msg)       { return PRIVATE_PATTERNS.filter(p => p.re.test(msg)); }
export function isInsuranceMention(msg)  { return INSURANCE_PATTERN.test(msg); }
export function isOptOut(msg)            { return OPT_OUT_PATTERN.test(msg); }
export function isFreebie(msg)           { return FREEBIE_PATTERN.test(msg); }
export function isUserClose(msg)         { return USER_INTENT_CLOSE_PATTERN.test(msg || ''); }
export function isIvanWalk(msg)          { return USER_WALK_PATTERN.test(msg); }

export function detectLegitimacy(msg) {
  for (const p of LEGITIMACY_PATTERNS) if (p.re.test(msg)) return p;
  return null;
}

// Walk-away probability when insurance is mentioned at given turn (turn is 1-indexed).
// Curve: P(walk) = 0.90 * exp(-0.35 * (turn - 1)), modulated by trust deficit.
// Turn 1: 90%, Turn 2: 63%, Turn 3: 45%, Turn 4: 31%, Turn 5: 22%, Turn 6: 16%
export function insuranceWalkProbability(turn, trust) {
  const base = 0.90 * Math.exp(-0.35 * (turn - 1));
  const trustModifier = (50 - (trust ?? 50)) / 200; // -0.25 to +0.25
  return Math.min(0.98, Math.max(0, base + trustModifier));
}
