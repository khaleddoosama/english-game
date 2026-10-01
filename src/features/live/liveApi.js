// Live Challenge backend. Online: Supabase RPCs (migration 0008) do every
// check on the server; answers never reach the players' devices before
// they answer. Local mode (no Supabase): the same interface over
// localStorage, so the game can be played and tested in several tabs.
import { isLocalMode, supabase } from "../../lib/supabase";
import { MAX_PLAYERS, MIN_PLAYERS, answerSlack, judgeAnswer, isSettled, randomCode, rankPlayers, splitQuestions, validateQuestions, visibleQuestions } from "./liveRules";

export class LiveError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const friendly = (error) => {
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new LiveError("You're offline. Live Challenge needs a connection.", "offline");
  return new LiveError(msg, error?.code);
};

/* ------------------------------------------------------------ online */

function supabaseApi(client) {
  const rpc = async (fn, args) => {
    let data, error;
    try { ({ data, error } = await client.rpc(fn, args)); } catch (e) { throw friendly(e); }
    if (error) throw friendly(error);
    return data;
  };
  return {
    mode: "online",
    create: ({ title, seconds, maxPlayers, startMode, settings, questions, hours }) => rpc("live_create", {
      p_title: title, p_seconds: seconds, p_max_players: maxPlayers, p_start_mode: startMode, p_settings: settings || {}, p_questions: questions, p_hours: hours,
    }),
    view: (code) => rpc("live_view", { p_code: code }),
    join: (code) => rpc("live_join", { p_code: code }),
    start: (code) => rpc("live_start", { p_code: code }),
    begin: (code) => rpc("live_begin", { p_code: code }),
    answer: (code, idx, choice, ms) => rpc("live_answer", { p_code: code, p_idx: idx, p_choice: choice, p_ms: Math.round(ms) }),
    end: (code) => rpc("live_end", { p_code: code }),
    leave: (code) => rpc("live_leave", { p_code: code }),
    removePlayer: (code, userId) => rpc("live_remove_player", { p_code: code, p_user: userId }),
    mine: () => rpc("live_mine"),
  };
}

/* ------------------------------------------------------------- local */

// storage: anything with getItem/setItem/removeItem/key/length (tests pass
// a Map-backed fake). me(): the current player { id, name }. Each player's
// progress has its own key, so tabs answering at the same moment never
// overwrite each other (the server gets the same from row locks).
export function createLocalLiveApi({ storage, me, now = () => Date.now(), clock = () => Date.now() }) {
  const metaKey = (code) => `live3:${String(code || "").toUpperCase()}`;
  const progKey = (code, uid) => `${metaKey(code)}:p:${uid}`;
  const read = (k) => { try { return JSON.parse(storage.getItem(k) || "null"); } catch { return null; } };
  const load = (code) => read(metaKey(code));
  const save = (c) => storage.setItem(metaKey(c.code), JSON.stringify(c));
  const blank = () => ({ started_at: null, last_at: null, answered: 0, correct: 0, total_ms: 0, finished_at: null, answers: [] });
  const prog = (code, uid) => read(progKey(code, uid)) || blank();
  const saveProg = (code, uid, p) => storage.setItem(progKey(code, uid), JSON.stringify(p));
  const players = (c) => c.members.map((m) => { const { answers, last_at, ...p } = prog(c.code, m.user_id); return { ...m, ...p }; });
  const iso = (t) => new Date(t).toISOString();
  const fail = (message, code) => { throw new LiveError(message, code); };
  const mustGet = (code) => load(code) || fail("No challenge with this code. Check the link or the code.", "P0002");

  function settle(c) {
    if (!c || c.state === "done" || !isSettled(c, players(c), now())) return c;
    const ranked = rankPlayers(players(c));
    Object.assign(c, { state: "done", ended_at: iso(now()), results: ranked.map((p) => ({ user_id: p.user_id, rank: p.rank, correct: p.correct, total_ms: p.total_ms, finished: !!p.finished_at, players: ranked.length, is_host: p.user_id === c.host_id })) });
    save(c);
    return c;
  }
  function view(code) {
    const c = settle(mustGet(code));
    const uid = me().id;
    const member = c.members.some((p) => p.user_id === uid);
    const rankOf = (id) => c.results?.find((r) => r.user_id === id)?.rank ?? null;
    return {
      code: c.code, title: c.title, host_id: c.host_id, host: c.host, question_count: c.question_count, seconds: c.seconds,
      max_players: c.max_players, start_mode: c.start_mode, settings: c.settings, state: c.state, created_at: c.created_at,
      started_at: c.started_at, ended_at: c.ended_at, expires_at: c.expires_at, now: iso(now()), member,
      questions: member ? visibleQuestions(c.questions, c.state, prog(c.code, uid)) : null,
      key: member && c.state === "done" ? c.key : null,
      players: players(c).map((p) => ({ ...p, rank: rankOf(p.user_id) })),
      my_answers: member ? prog(c.code, uid).answers : null,
    };
  }
  const publicRow = (p) => { const { answers, last_at, ...row } = p; return row; };

  return {
    mode: "local",
    async create({ title, seconds, maxPlayers, startMode, settings, questions, hours = 24 }) {
      if (!(maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS)) fail(`A challenge is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`, "22023");
      if (!["together", "anytime"].includes(startMode)) fail("Unknown start mode.", "22023");
      const problem = validateQuestions(questions);
      if (problem) fail(problem, "22023");
      let code = randomCode();
      for (let i = 0; i < 10 && load(code); i++) code = randomCode();
      const split = splitQuestions(questions);
      const t = now(), who = me();
      save({
        code, title: String(title || "Live Challenge").slice(0, 120), host_id: who.id, host: who.name, question_count: questions.length,
        seconds: seconds || 0, max_players: maxPlayers, start_mode: startMode, settings: settings || {},
        state: startMode === "anytime" ? "playing" : "lobby", created_at: iso(t), started_at: startMode === "anytime" ? iso(t) : null, ended_at: null,
        expires_at: iso(t + Math.max(1, Math.min(hours, 168)) * 3600000),
        questions: split.questions, key: split.key, members: [{ user_id: who.id, username: who.name, joined_at: iso(t) }],
      });
      return code;
    },
    async view(code) { return view(code); },
    async join(code) {
      const c = settle(mustGet(code)), who = me();
      if (!c.members.some((p) => p.user_id === who.id)) {
        if (c.state === "done") fail("This challenge has already ended.", "55000");
        if (c.start_mode === "together" && c.state !== "lobby") fail("This challenge has already started.", "55000");
        if (c.members.length >= c.max_players) fail(`This challenge is full (${c.max_players} players).`, "55000");
        c.members.push({ user_id: who.id, username: who.name, joined_at: iso(now()) });
        save(c);
      }
      return view(c.code);
    },
    async start(code) {
      const c = mustGet(code);
      if (c.host_id !== me().id) fail("Only the creator can start this challenge.", "42501");
      if (c.state !== "lobby") return;
      if (c.members.length < 2) fail("Wait for at least one more player.", "55000");
      Object.assign(c, { state: "playing", started_at: iso(now()), expires_at: iso(Math.min(Date.parse(c.expires_at), now() + 3 * 3600000)) });
      save(c);
    },
    async begin(code) {
      const c = settle(mustGet(code)), uid = me().id;
      if (c.state !== "playing") fail("This challenge isn't running.", "55000");
      if (!c.members.some((m) => m.user_id === uid)) fail("Join the challenge first.", "42501");
      const p = prog(c.code, uid);
      saveProg(c.code, uid, { ...p, started_at: p.started_at || iso(now()), last_at: p.last_at ?? clock() });
      return view(c.code);
    },
    async answer(code, idx, choice, ms) {
      const c = mustGet(code), uid = me().id;
      if (!c.members.some((m) => m.user_id === uid)) fail("Join the challenge first.", "42501");
      const p = prog(c.code, uid), key = c.key[idx];
      const next = c.questions[idx + 1] ?? null;
      const prev = p.answers.find((a) => a.idx === idx);
      if (prev) return { ...prev, ...key, me: publicRow(p), next };
      if (c.state !== "playing" || Date.parse(c.expires_at) < now()) { settle(c); fail("This challenge has ended.", "55000"); }
      if (p.finished_at) fail("You've answered every question.", "55000");
      if (idx !== p.answered) fail("Answer the questions in order.", "22023");
      if (!p.started_at) fail("Press Start first.", "55000");
      const slack = answerSlack(p.answers.find((a) => a.idx === idx - 1), c.settings?.reveal !== false);
      const result = judgeAnswer({ choice, answer: key.answer, claimedMs: ms, elapsedMs: clock() - p.last_at, seconds: c.seconds, slack });
      p.answers.push({ idx, ...result });
      p.answered += 1; p.correct += result.correct ? 1 : 0; p.total_ms += result.ms; p.last_at = clock();
      if (p.answered >= c.question_count) p.finished_at = iso(now());
      saveProg(c.code, uid, p);
      const after = settle(load(c.code));
      return { idx, ...result, ...key, me: publicRow(p), next, done: after.state === "done" };
    },
    async end(code) {
      const c = mustGet(code);
      if (c.host_id !== me().id) fail("Only the creator can end this challenge.", "42501");
      if (c.state === "lobby") c.state = "playing";
      c.expires_at = iso(now() - 1);
      settle(c);
    },
    async leave(code) {
      const c = load(code); if (!c) return;
      const uid = me().id;
      if (c.host_id === uid && c.state === "lobby") {
        for (const m of c.members) storage.removeItem(progKey(c.code, m.user_id));
        storage.removeItem(metaKey(c.code));
        return;
      }
      if (prog(c.code, uid).started_at) return;
      c.members = c.members.filter((m) => m.user_id !== uid);
      storage.removeItem(progKey(c.code, uid));
      save(c); settle(c);
    },
    async removePlayer(code, userId) {
      const c = mustGet(code);
      if (c.host_id !== me().id) fail("Only the creator can remove players.", "42501");
      if (userId === me().id) fail("You can't remove yourself.", "22023");
      if (prog(c.code, userId).started_at) return;
      c.members = c.members.filter((m) => m.user_id !== userId);
      storage.removeItem(progKey(c.code, userId));
      save(c);
    },
    async mine() {
      const uid = me().id, out = [];
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      for (const k of keys) {
        if (!k?.startsWith("live3:") || k.includes(":p:")) continue;
        const c = load(k.slice(6));
        if (!c?.members.some((m) => m.user_id === uid)) continue;
        const p = prog(c.code, uid);
        out.push({ code: c.code, title: c.title, state: c.state !== "done" && Date.parse(c.expires_at) < now() ? "done" : c.state, start_mode: c.start_mode,
          question_count: c.question_count, max_players: c.max_players, created_at: c.created_at, expires_at: c.expires_at, host: c.host_id === uid,
          players: c.members.length, answered: p.answered, correct: p.correct, finished: !!p.finished_at, rank: c.results?.find((r) => r.user_id === uid)?.rank ?? null });
      }
      return out.sort((a, b) => (a.state === "done") - (b.state === "done") || b.created_at.localeCompare(a.created_at));
    },
  };
}

let current = null;
export function getLiveApi(me) {
  if (current) return current;
  current = isLocalMode
    ? createLocalLiveApi({ storage: window.localStorage, me, clock: () => performance.now() + performance.timeOrigin })
    : supabaseApi(supabase);
  return current;
}

// Answers are safe to resend (the server returns the first result), so a
// dropped connection is retried a couple of times before giving up.
export async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (e?.code && e.code !== "offline") throw e; // a real "no" from the server
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}
