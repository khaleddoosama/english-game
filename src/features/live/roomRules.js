// The challenge room's rules, no React: questions already shown are kept, the next question goes in its place, my own
// row is used until the server's catches up, a "progress" signal updates one row, how often the room asks again, when
// a finished room watches for a rematch, and which screen shows. Docs: docs/modules/live/challenge-room.md.

// Questions arrive one at a time (with Start, then with each answer); a slower read of the same challenge never takes
// back a question already shown (until the end, when the server's full list is used).
export function keepShown(cur, next) {
  const have = next?.questions?.length || 0;
  if (cur?.code === next?.code && next?.state !== "done" && (cur?.questions?.length || 0) > have) return { ...next, questions: [...(next.questions || []), ...cur.questions.slice(have)] };
  return next;
}

// The next question that came with an answer, in its place; null when there is nothing to change.
export function withQuestion(cur, i, q) {
  if (!cur || !q || cur.questions?.[i]) return null;
  const questions = [...(cur.questions || [])];
  questions[i] = q;
  return { ...cur, questions };
}

// A "progress" signal: that player's row, unless it is older than the one on screen.
export const withProgress = (cur, payload) => ({ ...cur, players: cur.players.map((p) => (p.user_id === payload.user_id && payload.answered >= p.answered ? { ...p, ...payload } : p)) });

// Someone has the room open who is not in its list: time to ask again.
export const someoneNew = (view, present) => {
  const known = new Set((view?.players || []).map((p) => p.user_id));
  return present.some((p) => !known.has(p.id));
};

// My row: the server's, or the one from my last answer while that has answered more.
export function myRow(view, playerId, localMe) {
  const serverMe = view.players.find((p) => p.user_id === playerId) || null;
  return serverMe && localMe && localMe.answered > serverMe.answered ? { ...serverMe, ...localMe } : serverMe;
}

// The "progress" signal a player sends after an answer.
export const progressSignal = (playerId, row) => ({ user_id: playerId, answered: row.answered, correct: row.correct, total_ms: row.total_ms, finished_at: row.finished_at, started_at: row.started_at });

// Asking again while the challenge is not over: slowly while the channel works, often while it does not.
export const roomPollMs = (channelState) => (channelState === "live" ? 20000 : 4000);

// A finished challenge I am in, with no rematch yet, is checked for one for half an hour after it ended.
export const REMATCH_POLL_MS = 8000;
const REMATCH_WATCH_MS = 30 * 60000;
export function watchesRematch(view, now = Date.now()) {
  if (!view || view.state !== "done" || !view.member || view.settings?.next_code) return false;
  return !(now - (Date.parse(view.ended_at || view.expires_at) || now) > REMATCH_WATCH_MS);
}

// Which screen: "invite", "lobby", "results", "ready", "play" or "waiting".
export function roomScreen(view, me) {
  if (!view.member) return "invite";
  if (view.state === "lobby") return "lobby";
  if (view.state === "done") return "results";
  if (!me?.started_at) return "ready";
  if (!me.finished_at) return "play";
  return "waiting";
}
