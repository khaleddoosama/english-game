// Merging one player's progress when two devices (or tabs) changed it.
// Three-way: base is what this device last saw on the server, local is
// this device's state, server is what is there now. A field only one side
// changed takes that side; a field both changed is merged by its meaning
// (counters add up, bests take the higher, lists of rounds join by id).
// Pure functions, no I/O.
import { confusionCount } from "../engine/data";
import { stableJson } from "./stableJson";

export const HISTORY_LIMIT = 50;
const COMPLETED_LIMIT = 500;
const same = (a, b) => stableJson(a) === stableJson(b);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Per key: unchanged on one side -> the other side; changed on both -> merge.
export function mergeMap(base, local, server, both = (_k, _b, l) => l) {
  const b = isObj(base) ? base : {}, l = isObj(local) ? local : {}, s = isObj(server) ? server : {};
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(s)])) {
    let v;
    if (same(l[k], b[k])) v = s[k];
    else if (same(s[k], b[k])) v = l[k];
    else v = both(k, b[k], l[k], s[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// A counter both sides added to: server + what this device added.
const added = (b, l, s) => (b === undefined ? Math.max(num(l), num(s)) : num(s) + num(l) - num(b));
const unionById = (l, s, key = (x) => x?.id) => {
  const seen = new Map();
  for (const x of [...(Array.isArray(s) ? s : []), ...(Array.isArray(l) ? l : [])]) { const k = key(x); if (k != null) seen.set(k, x); }
  return [...seen.values()];
};
const laterDate = (a, b) => (String(a || "") >= String(b || "") ? a : b);

function mergeDaily(b, l, s) {
  if (!l || !s) return l || s;
  if (l.date !== s.date) return String(l.date) > String(s.date) ? l : s;
  const fromBase = b && b.date === l.date ? b : { answered: 0, correct: 0 };
  return { ...s, ...l, answered: num(s.answered) + num(l.answered) - num(fromBase.answered), correct: num(s.correct) + num(l.correct) - num(fromBase.correct) };
}
// Per day: both devices' rounds count. A day the base doesn't have started
// at zero, unless there's no base at all (then the larger, to never count
// the same rounds twice).
function mergeDailyHistory(b, l, s) {
  const known = isObj(b);
  return mergeMap(b, l, s, (_k, bb, ll = {}, ss = {}) => {
    const add = (f) => (bb || known ? num(ss[f]) + num(ll[f]) - num(bb?.[f]) : Math.max(num(ll[f]), num(ss[f])));
    return { rounds: add("rounds"), answered: add("answered"), correct: add("correct") };
  });
}
function mergeLevelStats(b, l, s) {
  return mergeMap(b, l, s, (_k, bb = {}, ll = {}, ss = {}) => ({
    ...ss, ...ll,
    attempts: added(bb.attempts, ll.attempts, ss.attempts),
    bestAccuracy: Math.max(num(ll.bestAccuracy), num(ss.bestAccuracy)),
    stars: Math.max(num(ll.stars), num(ss.stars)),
    lastPlayedAt: Math.max(num(ll.lastPlayedAt), num(ss.lastPlayedAt)) || null,
  }));
}
function mergeConfusions(b, l, s) {
  return mergeMap(b, l, s, (_k, bb, ll, ss) => {
    const count = added(bb === undefined ? undefined : confusionCount(bb), confusionCount(ll), confusionCount(ss));
    const lastAt = Math.max(num(ll?.lastAt), num(ss?.lastAt)) || undefined;
    return lastAt ? { count, lastAt } : count;
  });
}

// One field of the progress object.
export function mergeField(field, base, local, server, ctx = {}) {
  switch (field) {
    case "score": case "attempted": return added(base, local, server);
    case "bestStreak": case "bestStudyStreak": case "bestSpeedScore": case "bestSpeedCombo": return Math.max(num(local), num(server));
    case "lastStudyDate": return laterDate(local, server);
    case "studyStreak": return String(ctx.local?.lastStudyDate || "") >= String(ctx.server?.lastStudyDate || "") ? local : server;
    case "dailyProgress": return mergeDaily(base, local, server);
    case "dailyHistory": return mergeDailyHistory(base, local, server);
    case "sessionLogs": return unionById(local, server).sort((a, c) => num(c?.at) - num(a?.at)).slice(0, Math.max(HISTORY_LIMIT, (local || []).length));
    case "completedSessions": return [...new Set([...(server || []), ...(local || [])])].slice(-COMPLETED_LIMIT);
    case "solvedStories": case "reports": return unionById(local, server);
    case "levelsCleared": return [...new Set([...(server || []), ...(local || [])])];
    case "levelStats": return mergeLevelStats(base, local, server);
    case "confusions": return mergeConfusions(base, local, server);
    case "pools": return mergeMap(base, local, server, (_k, bb, ll, ss) => mergeMap(bb, ll, ss));
    case "seenSentences": return mergeMap(base, local, server, (_k, _b, ll, ss) => Math.max(num(ll), num(ss)));
    default: return local; // settings, activeSession, the current answer streak: this device's
  }
}

// One saved section ({ field: value }).
export function mergeSection(base, local, server) {
  const b = isObj(base) ? base : {}, l = isObj(local) ? local : {}, s = isObj(server) ? server : {};
  const out = {};
  for (const f of new Set([...Object.keys(l), ...Object.keys(s)])) {
    let v;
    if (same(l[f], b[f])) v = s[f];
    else if (same(s[f], b[f])) v = l[f];
    else v = mergeField(f, b[f], l[f], s[f], { base: b, local: l, server: s });
    if (v !== undefined) out[f] = v;
  }
  return out;
}

// One word's record. Both changed: the record with more answers, keeping
// every round either device counted so a round is never counted twice.
export function mergeMasteryRecord(base, local, server) {
  if (same(local, base)) return server;
  if (same(server, base) || !server) return local;
  if (!local) return server;
  const winner = num(local.total) >= num(server.total) ? local : server;
  const union = (k) => [...new Set([...(server[k] || []), ...(local[k] || [])])];
  return { ...winner, appliedSessions: union("appliedSessions").slice(-50), independentSessions: union("independentSessions").slice(-20) };
}
export function mergeMastery(base, local, server) {
  const b = base || {}, l = local || {}, s = server || {};
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(s)])) {
    const v = mergeMasteryRecord(b[k], l[k], s[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
