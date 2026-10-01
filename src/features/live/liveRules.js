// Live Challenge rules, shared by the local (offline/test) backend and the
// UI. The server applies the same rules in SQL (migration 0008):
//  - 2 to 10 players, 3 to 50 questions, answered in order at each
//    player's own pace;
//  - the winner has the most right answers; a tie goes to whoever finished,
//    then to the fastest total time.
export const LIVE_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LIVE_CODE_RE = /^[A-Z0-9]{6}$/;
export const MIN_PLAYERS = 2, MAX_PLAYERS = 10, MIN_QUESTIONS = 3, MAX_QUESTIONS = 50;
// Time allowed between answers for the feedback card and the network,
// on top of what the device measured (see clampAnswerMs).
export const ANSWER_SLACK_MS = 4000;
// How long the right/wrong card stays before the next question.
export const FEEDBACK_MS = { correct: 900, wrong: 1800 };

export const randomCode = (rng = Math.random) => Array.from({ length: 6 }, () => LIVE_CODE_CHARS[Math.floor(rng() * LIVE_CODE_CHARS.length)]).join("");

// Accepts a code, a /live/CODE path or a full link someone pasted.
export function codeFromInput(text) {
  const s = String(text || "").trim();
  const fromLink = /\/live\/([A-Za-z0-9]{6})(?:[/?#]|$)/.exec(s);
  const code = (fromLink ? fromLink[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return LIVE_CODE_RE.test(code) ? code : null;
}

export function challengeLink(code, origin = typeof window !== "undefined" ? window.location.origin : "") {
  return `${origin}/live/${code}`;
}

export const sameAnswer = (a, b) => a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// The device measures how long the player looked at the question; the
// server only knows how long since the previous answer (which also covers
// the feedback card and the network). Trust the device, but never more
// than the elapsed time and never less than elapsed minus the slack.
export function clampAnswerMs(claimed, elapsed) {
  const e = Math.max(0, Math.floor(elapsed));
  const c = Number.isFinite(claimed) ? claimed : e;
  return Math.min(Math.max(c, 0, e - ANSWER_SLACK_MS), e);
}

// Scores one answer. seconds = 0 means no time limit; over the limit
// counts as no answer.
export function judgeAnswer({ choice, answer, claimedMs, elapsedMs, seconds }) {
  let ms = clampAnswerMs(claimedMs, elapsedMs);
  let picked = choice == null || String(choice).trim() === "" ? null : String(choice).trim();
  let correct = sameAnswer(picked, answer);
  if (seconds > 0 && ms > seconds * 1000) { ms = seconds * 1000; correct = false; picked = null; }
  return { choice: picked, correct, ms };
}

// Players who started, best first, with shared ranks for exact ties.
export function rankPlayers(players) {
  const started = players.filter((p) => p.started_at || p.answered > 0);
  const key = (p) => [-(p.correct || 0), p.finished_at ? 0 : 1, Number(p.total_ms || 0)];
  const sorted = [...started].sort((a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
  let rank = 0;
  return sorted.map((p, i) => {
    const prev = sorted[i - 1];
    if (!prev || key(prev).join() !== key(p).join()) rank = i + 1;
    return { ...p, rank };
  });
}

// Standings during play: everyone (started or not), by the same order.
export function standings(players) {
  const ranked = rankPlayers(players);
  const ids = new Set(ranked.map((p) => p.user_id));
  return [...ranked, ...players.filter((p) => !ids.has(p.user_id)).map((p) => ({ ...p, rank: null }))];
}

// Is the challenge over? Together: everyone finished. Anytime: full and
// everyone finished. Either: past its expiry.
export function isSettled(challenge, players, now = Date.now()) {
  if (challenge.state === "done") return true;
  if (Date.parse(challenge.expires_at) < now) return true;
  if (challenge.state !== "playing" || !players.length) return false;
  const allDone = players.every((p) => p.finished_at);
  return allDone && (challenge.start_mode === "together" || players.length >= challenge.max_players);
}

export function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) return `A challenge needs ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions.`;
  for (const q of questions) {
    if (!q?.prompt || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8 || !q.answer || !q.options.some((o) => sameAnswer(o, q.answer))) {
      return "Every question needs a prompt, 2-8 options and its answer among them.";
    }
  }
  return null;
}

// Splits built questions into what players see and the answer key.
export function splitQuestions(questions) {
  return {
    questions: questions.map(({ mode, prompt, options, picture, photo }) => Object.fromEntries(Object.entries({ mode, prompt, options, picture, photo }).filter(([, v]) => v != null))),
    key: questions.map(({ answer, word, explanation, sentences }) => ({ answer, word: word ?? null, explanation: explanation ?? null, sentences: sentences || [] })),
  };
}

export function formatMs(ms) {
  const s = Math.max(0, Math.round(Number(ms || 0) / 100) / 10);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
