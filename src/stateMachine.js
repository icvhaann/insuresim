// src/stateMachine.js
//
// Explicit server-side stage + outcome machine.
// v4 fix for Problem 1: the client can still compute stage averages, but the
// server is now the SINGLE source of truth for whether a session is allowed
// to advance or must terminate.
//
// Exit-intent handling (hard rule):
//   - Ivan expresses exit intent → session enters RECOVERY_PENDING.
//   - Seller has ONE turn to recover. Recovery criteria (all required):
//       (a) seller's next message acknowledges Ivan's objection (apology /
//           empathy / acknowledgment keywords), AND
//       (b) seller does NOT push a close or pitch in the same message, AND
//       (c) seller's message is ≥ 20 chars (not just "ok" / "sure").
//   - After seller's recovery turn, if Ivan's NEXT reply still has exit intent
//     or if the seller didn't meet criteria → session terminates.
//   - If Ivan re-engages positively after a valid recovery attempt → state
//     resets to NORMAL.
//   - Only ONE recovery attempt per session. A second exit-intent → hard terminate.
//
// Stage progression guards:
//   - Cannot advance while state == EXIT_INTENT_EXPRESSED or RECOVERY_PENDING.
//   - Cannot advance if the last turn scored poorly (quality === 'bad') AND the
//     stageScoreAccum is below threshold.
//   - Mis-sell outcomes are terminal — no further stage advance allowed.

export const SESSION_STATES = Object.freeze({
  NORMAL:                 'normal',
  EXIT_INTENT_EXPRESSED:  'exit_intent_expressed',   // Ivan just said "not interested" etc.
  RECOVERY_PENDING:       'recovery_pending',        // seller gets one turn to address it
  RECOVERED:              'recovered',               // seller's recovery worked, back to normal next turn
  TERMINATED:             'terminated',              // session ended (any outcome)
});

// Recovery-message heuristics. All three must hold for the seller's recovery
// turn to count as a genuine attempt.
const ACKNOWLEDGE_KEYWORDS = /\b(sorry|apolog|understand|fair\s*enough|got\s*it|no\s*worries|no\s*problem|noted|fair\s*point|you're\s*right|makes\s*sense|hear\s*you|totally\s*get)/i;
const PUSH_KEYWORDS = /\b(but\s*(just|maybe|perhaps|consider|think)|however|before\s*you\s*go|just\s*one\s*more|last\s*thing|quick\s*question|would\s*you\s*(at\s*least|still)|sign\s*up|send\s*the\s*link|one\s*last\s*pitch)/i;

export function evaluateRecoveryAttempt(sellerMsg) {
  const msg = sellerMsg || '';
  const acknowledges = ACKNOWLEDGE_KEYWORDS.test(msg);
  const pushes = PUSH_KEYWORDS.test(msg);
  const longEnough = msg.trim().length >= 20;
  const valid = acknowledges && !pushes && longEnough;
  return {
    valid,
    acknowledges,
    pushes,
    longEnough,
    reason: valid
      ? 'genuine acknowledgment, no re-pitch, substantive'
      : !acknowledges
        ? 'no acknowledgment of the objection'
        : pushes
          ? 'tried to push another pitch / "just one more thing"'
          : 'message too short to be a real acknowledgment',
  };
}

// Transition table. Given current session state + latest signals, return the
// next state AND any terminal outcome if applicable.
//
// Inputs:
//   currentState: one of SESSION_STATES
//   signals: {
//     ivanExitIntent: bool — Ivan's latest reply shows exit intent
//     ivanReengaged:  bool — Ivan's latest reply is positive/curious (for recovery detection)
//     recoveryAttempted: bool — was this turn a seller recovery turn?
//     recoveryValid: bool — did the seller's recovery meet criteria?
//     exitIntentCount: number — how many times Ivan has shown exit intent this session
//   }
// Returns: { nextState, terminate, terminalOutcome?, terminalReason? }
export function transition(currentState, signals) {
  const {
    ivanExitIntent = false,
    ivanReengaged  = false,
    recoveryAttempted = false,
    recoveryValid  = false,
    exitIntentCount = 0,
  } = signals || {};

  // Already terminated — stay terminated.
  if (currentState === SESSION_STATES.TERMINATED) {
    return { nextState: SESSION_STATES.TERMINATED, terminate: false };
  }

  // ── From NORMAL ────────────────────────────────────────────
  if (currentState === SESSION_STATES.NORMAL) {
    if (ivanExitIntent) {
      return {
        nextState: SESSION_STATES.EXIT_INTENT_EXPRESSED,
        terminate: false,
      };
    }
    return { nextState: SESSION_STATES.NORMAL, terminate: false };
  }

  // ── From EXIT_INTENT_EXPRESSED ─────────────────────────────
  // Seller is about to take their recovery turn. The NEXT server chat call
  // (the one with the seller's recovery message) will flip to RECOVERY_PENDING.
  if (currentState === SESSION_STATES.EXIT_INTENT_EXPRESSED) {
    // The seller has now replied. Evaluate their attempt.
    if (!recoveryAttempted) {
      return { nextState: SESSION_STATES.EXIT_INTENT_EXPRESSED, terminate: false };
    }
    if (!recoveryValid) {
      return {
        nextState: SESSION_STATES.TERMINATED,
        terminate: true,
        terminalOutcome: 'failed_exit_intent',
        terminalReason: "Ivan wanted out; your reply didn't address it with a real acknowledgment.",
      };
    }
    // Valid attempt. We now wait on Ivan's next reply. Only ONE recovery
    // attempt is allowed per session, so track exitIntentCount.
    return {
      nextState: SESSION_STATES.RECOVERY_PENDING,
      terminate: false,
    };
  }

  // ── From RECOVERY_PENDING ──────────────────────────────────
  // Ivan has just replied to the seller's recovery turn.
  if (currentState === SESSION_STATES.RECOVERY_PENDING) {
    if (ivanExitIntent) {
      // Second exit-intent → hard terminate regardless.
      return {
        nextState: SESSION_STATES.TERMINATED,
        terminate: true,
        terminalOutcome: 'failed_exit_intent',
        terminalReason: "Ivan still wanted out after the recovery attempt.",
      };
    }
    if (ivanReengaged) {
      return {
        nextState: SESSION_STATES.RECOVERED,
        terminate: false,
      };
    }
    // Ambiguous — Ivan replied but was neither clearly re-engaged nor exit-intent.
    // Give the seller one more normal turn but stay watchful.
    return {
      nextState: SESSION_STATES.RECOVERED,
      terminate: false,
    };
  }

  // ── From RECOVERED ─────────────────────────────────────────
  if (currentState === SESSION_STATES.RECOVERED) {
    if (ivanExitIntent) {
      // Any further exit-intent after a recovery → hard terminate.
      // (Policy: you only get one recovery attempt per session.)
      return {
        nextState: SESSION_STATES.TERMINATED,
        terminate: true,
        terminalOutcome: 'failed_exit_intent',
        terminalReason: "Ivan expressed exit intent again after the recovery — second time is terminal.",
      };
    }
    return { nextState: SESSION_STATES.NORMAL, terminate: false };
  }

  return { nextState: currentState, terminate: false };
}

// Is the session allowed to advance to the next stage? Enforced by server
// before passing stage-advance information back to client.
export function canAdvanceStage(sessionState, lastTurnQuality, stageScoreAccum, threshold) {
  if (sessionState === SESSION_STATES.TERMINATED) return false;
  if (sessionState === SESSION_STATES.EXIT_INTENT_EXPRESSED) return false;
  if (sessionState === SESSION_STATES.RECOVERY_PENDING)      return false;
  // Otherwise: standard threshold check (client-side still does this; this is
  // the server-side safety net).
  return stageScoreAccum >= threshold;
}
