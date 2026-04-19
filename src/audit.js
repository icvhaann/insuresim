// src/audit.js
// In-memory ring-buffered session log. Ephemeral — clears on restart.
// Consumed by the debrief flow, the per-session HTML download, and the facilitator
// HTML export endpoint.

const MAX_SESSIONS = 200;
const sessions = new Map();
const order = [];

export function createSession(sessionId, archetypeKey, insuranceNeedKey) {
  if (sessions.has(sessionId)) return;
  sessions.set(sessionId, {
    sessionId,
    archetypeKey,
    insuranceNeedKey,
    startedAt: Date.now(),
    endedAt: null,
    outcome: null,
    finalState: null,
    turns: [],
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

export function attachDebrief(sessionId, debrief) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.debrief = debrief;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function exportAll() {
  return Array.from(sessions.values());
}
