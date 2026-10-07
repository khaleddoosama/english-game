// Friends and invitations to Live challenges. Online: Supabase functions
// (migration 0024) do every check. Local mode (no Supabase): the same
// interface over localStorage, so two tabs can try it and the tests can run
// it; the local side mirrors the server's rules and messages.
import { isLocalMode, supabase } from "../../lib/supabase";
import { getLiveApi } from "../live/liveApi";

export class FriendsError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const friendly = (error) => {
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new FriendsError("You're offline. Friends need a connection.", "offline");
  return new FriendsError(msg, error?.code);
};

export const MAX_FRIENDS = 100;
export const MAX_WAITING = 20;
export const MAX_INVITES = 20;
export const DECLINE_WAIT_MS = 7 * 86400000;
export const normalizeUsername = (s) => String(s ?? "").trim().toLowerCase();

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
    list: () => rpc("friends_list"),
    request: (username) => rpc("friend_request", { p_username: username }),
    respond: (userId, accept) => rpc("friend_respond", { p_user: userId, p_accept: !!accept }),
    remove: (userId) => rpc("friend_remove", { p_user: userId }),
    counts: () => rpc("social_counts"),
    invite: (code, userIds) => rpc("live_invite_friends", { p_code: code, p_users: userIds }),
    myInvites: () => rpc("live_my_invites"),
    dismissInvite: (code) => rpc("live_invite_dismiss", { p_code: code }),
    invitesSent: (code) => rpc("live_invites_sent", { p_code: code }),
  };
}

/* ------------------------------------------------------------- local */

// storage: anything with getItem/setItem/removeItem/key/length (tests pass a
// Map-backed fake). me(): the current player { id, name }. live: the Live
// API, to look at a challenge from this player's side.
export function createLocalFriendsApi({ storage, me, live, now = () => Date.now() }) {
  const usersKey = "friends1:users";
  const pairKey = (x, y) => `friends1:p:${[x, y].sort().join("|")}`;
  const inviteKey = (code, uid) => `friends1:i:${String(code).toUpperCase()}:${uid}`;
  const read = (k) => { try { return JSON.parse(storage.getItem(k) || "null"); } catch { return null; } };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const iso = (t) => new Date(t).toISOString();
  const fail = (message, code) => { throw new FriendsError(message, code); };
  const keysWith = (prefix) => {
    const out = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(prefix)) out.push(k); }
    return out;
  };

  // Everyone who has opened the game in this browser: how a username is found.
  const users = () => read(usersKey) || {};
  const nameOf = (id) => users()[id] || "player";
  const touch = () => {
    const who = me(), all = users();
    if (all[who.id] !== who.name) { all[who.id] = who.name; write(usersKey, all); }
    return who;
  };
  const pairs = () => keysWith("friends1:p:").map(read).filter(Boolean);
  const pairsOf = (uid) => pairs().filter((r) => r.a === uid || r.b === uid);
  const otherOf = (r, uid) => (r.a === uid ? r.b : r.a);
  const friendCount = (uid) => pairsOf(uid).filter((r) => r.status === "accepted").length;
  const areFriends = (x, y) => read(pairKey(x, y))?.status === "accepted";
  const checkRoom = (uid, otherName) => {
    if (friendCount(uid) >= MAX_FRIENDS) fail(otherName ? `${otherName} has too many friends to add more.` : `You have ${MAX_FRIENDS} friends, the most there can be.`, "55000");
  };
  const save = (r, patch) => write(pairKey(r.a, r.b), { ...r, ...patch, updated_at: iso(now()) });

  return {
    mode: "local",

    async request(username) {
      const who = touch(), name = normalizeUsername(username);
      const found = Object.entries(users()).find(([, n]) => normalizeUsername(n) === name);
      if (!found) fail(`No player is called "${name}". Check the spelling.`, "P0002");
      const [tid, tname] = found;
      if (tid === who.id) fail("That is you.", "22023");
      const old = read(pairKey(who.id, tid));
      if (old) {
        if (old.status === "accepted") fail(`You are already friends with ${tname}.`, "55000");
        if (old.status === "pending") {
          if (old.by === who.id) fail(`You already asked ${tname}. Waiting for them to answer.`, "55000");
          if (friendCount(who.id) >= MAX_FRIENDS) fail(`You have ${MAX_FRIENDS} friends, the most there can be.`, "55000");
          if (friendCount(tid) >= MAX_FRIENDS) fail(`${tname} has too many friends to add more.`, "55000");
          save(old, { status: "accepted" });
          return { status: "accepted", id: tid, username: tname };
        }
        if (old.by === who.id && Date.parse(old.updated_at) > now() - DECLINE_WAIT_MS) fail(`${tname} did not accept your request. You can ask again after a week.`, "55000");
      }
      if (friendCount(who.id) >= MAX_FRIENDS) fail(`You have ${MAX_FRIENDS} friends, the most there can be.`, "55000");
      checkRoom(tid, tname);
      if (pairs().filter((r) => r.status === "pending" && r.by === who.id).length >= MAX_WAITING) fail(`You have ${MAX_WAITING} requests waiting for an answer. Wait for some of them first.`, "55000");
      const [a, b] = [who.id, tid].sort();
      write(pairKey(a, b), { a, b, by: who.id, status: "pending", created_at: iso(now()), updated_at: iso(now()) });
      return { status: "pending", id: tid, username: tname };
    },

    async respond(userId, accept) {
      const who = touch(), r = read(pairKey(who.id, userId));
      if (!r || r.status !== "pending" || r.by !== userId) fail("There is no request from this player.", "P0002");
      if (accept) {
        if (friendCount(who.id) >= MAX_FRIENDS) fail(`You have ${MAX_FRIENDS} friends, the most there can be.`, "55000");
        if (friendCount(userId) >= MAX_FRIENDS) fail("This player has too many friends to add more.", "55000");
        save(r, { status: "accepted" });
      } else save(r, { status: "declined" });
    },

    async remove(userId) {
      const who = touch(), k = pairKey(who.id, userId), r = read(k);
      if (r && (r.status === "accepted" || (r.status === "pending" && r.by === who.id))) storage.removeItem(k);
    },

    async list() {
      const who = touch();
      const rows = pairsOf(who.id);
      const row = (r, extra = {}) => ({ id: otherOf(r, who.id), username: nameOf(otherOf(r, who.id)), ...extra });
      const byName = (x, y) => x.username.localeCompare(y.username);
      return {
        friends: rows.filter((r) => r.status === "accepted").map((r) => row(r, { score: 0, week_score: 0, week_start: null, mastered_count: 0, study_streak: 0, live_wins: 0, live_played: 0, since: r.updated_at })).sort(byName),
        incoming: rows.filter((r) => r.status === "pending" && r.by !== who.id).map((r) => row(r, { at: r.created_at })).sort((x, y) => y.at.localeCompare(x.at)),
        outgoing: rows.filter((r) => r.status === "pending" && r.by === who.id).map((r) => row(r, { at: r.created_at })).sort((x, y) => y.at.localeCompare(x.at)),
      };
    },

    async counts() {
      const who = touch();
      return {
        requests: pairsOf(who.id).filter((r) => r.status === "pending" && r.by !== who.id).length,
        invites: (await this.myInvites()).length,
      };
    },

    async invite(code, userIds) {
      const who = touch();
      const view = await live.view(code);
      if (!view.member) fail("Join the challenge first.", "42501");
      if (view.state === "done") fail("This challenge has already ended.", "55000");
      if (view.start_mode === "together" && view.state !== "lobby") fail("This challenge has already started.", "55000");
      const ids = userIds || [];
      if (ids.length > MAX_INVITES) fail(`Invite up to ${MAX_INVITES} friends at a time.`, "22023");
      let invited = 0;
      const skipped = [];
      for (const id of ids) {
        const k = inviteKey(view.code, id), old = read(k);
        if (id === who.id) skipped.push({ id, reason: "you" });
        else if (!areFriends(who.id, id)) skipped.push({ id, reason: "not a friend" });
        else if (view.players.some((p) => p.user_id === id)) skipped.push({ id, reason: "already in" });
        else if (old && !old.dismissed) skipped.push({ id, reason: "already invited" });
        else { write(k, { code: view.code, user_id: id, invited_by: who.id, created_at: iso(now()), dismissed: false }); invited++; }
      }
      return { invited, skipped };
    },

    async myInvites() {
      const who = touch(), out = [];
      for (const k of keysWith("friends1:i:")) {
        const i = read(k);
        if (!i || i.user_id !== who.id || i.dismissed || !areFriends(i.invited_by, who.id)) continue;
        let view = null;
        try { view = await live.view(i.code); } catch { continue; }
        if (view.member || view.state === "done" || Date.parse(view.expires_at) <= now()) continue;
        if (view.start_mode === "together" && view.state !== "lobby") continue;
        if (view.players.length >= view.max_players) continue;
        out.push({
          code: view.code, title: view.title, from: nameOf(i.invited_by), from_id: i.invited_by,
          question_count: view.question_count, seconds: view.seconds, max_players: view.max_players, players: view.players.length,
          start_mode: view.start_mode, state: view.state, invited_at: i.created_at, expires_at: view.expires_at,
        });
      }
      return out.sort((x, y) => y.invited_at.localeCompare(x.invited_at)).slice(0, MAX_INVITES);
    },

    async dismissInvite(code) {
      const who = touch(), k = inviteKey(code, who.id), i = read(k);
      if (i) write(k, { ...i, dismissed: true });
    },

    async invitesSent(code) {
      touch();
      const view = await live.view(code);
      if (!view.member) fail("Join the challenge first.", "42501");
      return keysWith(`friends1:i:${view.code}:`).map(read).filter((i) => i && !i.dismissed).map((i) => i.user_id);
    },
  };
}

let current = null;
export function getFriendsApi(me) {
  if (current) return current;
  current = isLocalMode
    ? createLocalFriendsApi({ storage: window.localStorage, me, live: getLiveApi(me) })
    : supabaseApi(supabase);
  return current;
}
