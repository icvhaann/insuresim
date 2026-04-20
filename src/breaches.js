// src/breaches.js
// Regex-based breach and signal detection.
// v4: exit-intent regex substantially expanded and now wired into the state machine.

// SEVERE breaches — exact private references
export const SEVERE_BREACH_PATTERNS = [
  { re: /\b(tai\s*tam|quarry\s*bay\s*reservoir)\b/i,                    label: 'specific trail running venue (Tai Tam / Quarry Bay)' },
  { re: /\b(hokkaido|niseko)\b/i,                                       label: 'specific ski destination (Hokkaido / Niseko)' },
  { re: /\b78\s*%/i,                                                    label: 'exact NBA watchtime drop percentage' },
  { re: /\b(8|6)\s*days?\b.{0,20}\b(japan|trip|travel|hokkaido|niseko)/i, label: 'exact trip duration in days' },
  { re: /\b(sai\s*ying\s*pun|syp)\b.{0,25}(gym|court|sports\s*complex|indoor)/i, label: 'specific gym/court location' },
  { re: /\bindoor\s*sports\s*complex\b/i,                               label: 'specific gym/court location' },
  { re: /\b(saturday|sunday|sat|sun)\b.{0,20}\b(7|8|9)\s*(am|a\.m\.|morning)/i, label: 'exact weekend morning schedule' },
  { re: /\b(3|three)\s*time(s)?\b.{0,20}\b(ankle|sprain|injur)/i,       label: 'exact personal injury count' },
  { re: /\b45\s*gb|forty.?five\s*gb/i,                                  label: 'exact monthly data usage' },
  { re: /\b(hkd?|hk\$)\s*\d{4,}/i,                                      label: 'specific HKD financial amount (4+ digits)' },
  { re: /\+44\b.{0,15}contact|\b8\s*frequent.{0,10}uk|\b3\s*daily.{0,10}uk/i, label: 'specific UK contact count' },
];

export const CONFIRMING_QUESTION_PATTERNS = [
  { re: /\bdid\s*you\s*(go|travel|visit|fly|trip).{0,20}(japan|hokkaido|niseko)/i, weight: 22, label: 'confirming Japan trip' },
  { re: /\bdid\s*you\s*(ski|snowboard).{0,20}(in|at).{0,8}(japan|hokkaido|niseko)/i, weight: 24, label: 'confirming ski destination' },
  { re: /\bdid\s*you\s*(run|hike|trail).{0,20}(at|in|near).{0,8}(tai\s*tam|quarry\s*bay)/i, weight: 26, label: 'confirming run venue' },
  { re: /\bhave\s*you\s*been\s*to\s*(hokkaido|niseko|tai\s*tam|quarry\s*bay)/i, weight: 24, label: 'confirming specific location' },
  { re: /\bdo\s*you\s*(still)?\s*(run|train|ski|play).{0,20}(at|in)\s*(tai\s*tam|quarry\s*bay|niseko|hokkaido|syp|sai\s*ying\s*pun)/i, weight: 22, label: 'confirming specific venue activity' },
];

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
  { re: /(hkd?|hk\$)\s*\d{4,}/i,                              weight: 24, label: 'specific HKD amount' },
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

// ─────────────────────────────────────────────────────────────
// v4: Close-intent on SELLER side moved to covers.js (isSellerCloseAttempt).
// Close-intent on IVAN side (seller success signal):
// ─────────────────────────────────────────────────────────────
export const USER_INTENT_CLOSE_PATTERN = /send.{0,10}(link|form|detail|info)|sign.?up|how\s*do\s*i\s*(get|apply|start)|i.ll\s*(take|do|get)\s*it|where\s*do\s*i|i.m\s*interested|let.s\s*do\s*it|count\s*me\s*in/i;

// ─────────────────────────────────────────────────────────────
// v4 — EXIT-INTENT detection in IVAN's messages.
// Now properly wired into the state machine. Significantly expanded from v3's
// dead USER_WALK_PATTERN so natural phrasings are caught.
//
// Covers:
// - explicit "not interested" / "I'll pass" / "not for me"
// - "bye", "later", "gotta go" endings
// - "leave it" / "skip it" dismissals
// - "won't be signing up" / "won't go for it"
// ─────────────────────────────────────────────────────────────
export const EXIT_INTENT_PATTERN = new RegExp(
  [
    // "not interested" variants
    /\bnot\s*interested\b/,
    /\bnot\s*for\s*me\b/,
    /\bnot\s*my\s*thing\b/,
    /\b(i'?ll|i\s*will|gonna)\s*pass\b/,
    /\bpass\s*on\s*(this|it)\b/,
    /\bi'?m\s*out\b/,
    /\bcount\s*me\s*out\b/,

    // "won't / doesn't work" variants
    /\b(won'?t|wouldn'?t)\s*(be|go)\s*(for|with|ahead|signing)\b/,
    /\bdoesn'?t\s*(work|fit)\s*for\s*me\b/,
    /\bnot\s*(gonna|going\s*to)\s*(do|sign|take|go)\b/,
    /\bno\s*(thanks|thank\s*you)\b/,

    // "I have / am fine already"
    /\b(already|i'?m)\s*(have|got|covered|sorted|fine|good)\b.{0,20}\b(cover|insur|plan|need)/,
    /\bfine\s*(with|without)\s*(my\s*)?current\b/,
    /\bprefer\s*(my|to\s*stick\s*with)\s*current\b/,
    /\brather\s*keep\b/,
    /\bi'?ll\s*stick\b/,

    // "leave it / skip it / let's leave it"
    /\bleave\s*it\b/,
    /\blet'?s\s*leave\s*it\b/,
    /\bskip\s*(it|this)\b/,
    /\bdrop\s*it\b/,

    // Goodbye endings (only match when clearly standalone exit)
    /^\s*(bye|goodbye|cya|peace|later)[\s.!]*$/,
    /^\s*(k\s*)?bye[\s.!]*$/,
    /\bgotta\s*go\b/,
    /\bi\s*(need\s*to|have\s*to|gotta)\s*(go|run|bounce)\b.{0,20}(bye|later|peace|that'?s\s*it)?/,
    /\bthat'?s\s*(it|all)\s*(for\s*me|from\s*me)/,

    // Explicit close-door
    /\bend\s*of\s*(discussion|conversation)\b/,
    /\bnothing\s*(more|else)\s*to\s*say\b/,
    /\bwe(\s*are|'?re)\s*done\s*here\b/,
  ].map(r => r.source).join('|'),
  'i'
);

export function detectSevere(msg)        { return SEVERE_BREACH_PATTERNS.filter(p => p.re.test(msg)); }
export function detectConfirmingQ(msg)   { return CONFIRMING_QUESTION_PATTERNS.filter(p => p.re.test(msg)); }
export function detectPrivate(msg)       { return PRIVATE_PATTERNS.filter(p => p.re.test(msg)); }
export function isInsuranceMention(msg)  { return INSURANCE_PATTERN.test(msg); }
export function isOptOut(msg)            { return OPT_OUT_PATTERN.test(msg); }
export function isFreebie(msg)           { return FREEBIE_PATTERN.test(msg); }
export function isUserClose(msg)         { return USER_INTENT_CLOSE_PATTERN.test(msg); }
export function isExitIntent(msg)        { return EXIT_INTENT_PATTERN.test(msg || ''); }

export function detectLegitimacy(msg) {
  for (const p of LEGITIMACY_PATTERNS) if (p.re.test(msg)) return p;
  return null;
}

// Walk-away probability on FIRST insurance mention.
// Turn 1: 90%, T2: 63%, T3: 45%, T4: 31%, T5: 22%, T6: 16%
export function insuranceWalkProbability(turn, trust) {
  const base = 0.90 * Math.exp(-0.35 * (turn - 1));
  const trustModifier = (50 - (trust ?? 50)) / 200;
  return Math.min(0.98, Math.max(0, base + trustModifier));
}
