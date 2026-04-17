// src/audit.js
// In-memory ring-buffered session log. Ephemeral — clears on restart.
// Used by the facilitator export endpoint and for debrief continuity.

const MAX_SESSIONS = 200;
const sessions = new Map();
const order = [];

export function createSession(sessionId, archetypeKey) {
  if (sessions.has(sessionId)) return;
  sessions.set(sessionId, {
    sessionId,
    archetypeKey,
    startedAt: Date.now(),
    endedAt: null,
    outcome: null,
    finalState: null,
    turns: []
  });
  order.push(sessionId);
  while (order.length > MAX_SESSIONS) {
    const oldId = order.shift();
    sessions.delete(oldId);
  }
}

export function logTurn(sessionId, turnData) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.turns.push({ ts: Date.now(), ...turnData });
}

export function endSession(sessionId, outcome, finalState) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.endedAt = Date.now();
  s.outcome = outcome;
  s.finalState = finalState;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function exportAll() {
  return Array.from(sessions.values());
}
