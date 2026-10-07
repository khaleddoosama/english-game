// Friends and invitations on the local backend (the same rules and messages as
// the server; supabase/tests/friends.sql covers the SQL side).
import { describe, expect, it } from "vitest";
import { DECLINE_WAIT_MS, MAX_FRIENDS, MAX_WAITING, createLocalFriendsApi, normalizeUsername } from "../src/features/social/friendsApi.js";
import { createLocalLiveApi } from "../src/features/live/liveApi.js";

const Q = (answer) => ({ mode: "meaning", prompt: `p-${answer}`, options: ["Apple", "Bread", "Cheese"], answer, word: answer.toLowerCase(), explanation: `about ${answer}`, sentences: [] });
const QS = [Q("Apple"), Q("Bread"), Q("Cheese")];

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
// Several players sharing one browser (storage) and one fake clock.
function world() {
  const storage = memoryStorage();
  let t = Date.parse("2026-10-01T10:00:00Z");
  const players = {};
  const as = (name) => {
    if (!players[name]) {
      const me = () => ({ id: `id-${name}`, name });
      const live = createLocalLiveApi({ storage, me, now: () => t, clock: () => t });
      players[name] = { id: `id-${name}`, name, friends: createLocalFriendsApi({ storage, me, live, now: () => t }), live };
    }
    return players[name];
  };
  return { as, storage, tick: (ms) => { t += ms; }, now: () => t };
}
const fails = async (promise, status) => { let error; try { await promise; } catch (e) { error = e; } expect(error?.code, error?.message).toBe(status);  };
// Everyone opens the game once, which is how others can find them by name.
const meet = async (w, ...names) => { for (const n of names) await w.as(n).friends.list(); };
const befriend = async (w, a, b) => { await w.as(a).friends.request(b); await w.as(b).friends.respond(w.as(a).id, true); };

describe("asking and answering", () => {
  it("finds a player by username, in any case, and lists the request on both sides", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    const r = await w.as("amr").friends.request("  BASSEM ");
    expect(r).toMatchObject({ status: "pending", username: "bassem" });
    expect((await w.as("amr").friends.list()).outgoing.map((x) => x.username)).toEqual(["bassem"]);
    const theirs = await w.as("bassem").friends.list();
    expect(theirs.incoming.map((x) => x.username)).toEqual(["amr"]);
    expect(await w.as("bassem").friends.counts()).toEqual({ requests: 1, invites: 0 });
    expect(normalizeUsername("  Hello ")).toBe("hello");
  });

  it("refuses yourself, a stranger's name, and asking twice", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    await fails(w.as("amr").friends.request("amr"), "22023");
    await fails(w.as("amr").friends.request("nobody"), "P0002");
    await w.as("amr").friends.request("bassem");
    await fails(w.as("amr").friends.request("bassem"), "55000");
  });

  it("only the one who was asked can answer", async () => {
    const w = world(); await meet(w, "amr", "bassem", "carol");
    await w.as("amr").friends.request("bassem");
    await fails(w.as("amr").friends.respond("id-bassem", true), "P0002");
    await fails(w.as("carol").friends.respond("id-amr", true), "P0002");
    await w.as("bassem").friends.respond("id-amr", true);
    const l = await w.as("amr").friends.list();
    expect(l.friends.map((f) => f.username)).toEqual(["bassem"]);
    expect(l.friends[0]).toHaveProperty("live_wins");
    expect((await w.as("bassem").friends.list()).friends.map((f) => f.username)).toEqual(["amr"]);
    await fails(w.as("amr").friends.request("bassem"), "55000");
  });

  it("asking someone who already asked you means yes", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    await w.as("amr").friends.request("bassem");
    const r = await w.as("bassem").friends.request("amr");
    expect(r.status).toBe("accepted");
    expect((await w.as("amr").friends.list()).friends).toHaveLength(1);
  });

  it("a decline makes the asker wait a week, but the other side may ask", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    await w.as("amr").friends.request("bassem");
    await w.as("bassem").friends.respond("id-amr", false);
    expect((await w.as("bassem").friends.list()).incoming).toHaveLength(0);
    await fails(w.as("amr").friends.request("bassem"), "55000");
    w.tick(DECLINE_WAIT_MS + 1000);
    expect((await w.as("amr").friends.request("bassem")).status).toBe("pending");
    await w.as("bassem").friends.respond("id-amr", false);
    await w.as("bassem").friends.request("amr");              // the one who declined asks
    await w.as("amr").friends.respond("id-bassem", true);
    expect((await w.as("amr").friends.list()).friends).toHaveLength(1);
  });

  it("removes a friend, or takes back a request, and removing twice is fine", async () => {
    const w = world(); await meet(w, "amr", "bassem", "carol");
    await befriend(w, "amr", "bassem");
    await w.as("amr").friends.remove("id-bassem");
    await w.as("amr").friends.remove("id-bassem");
    expect((await w.as("bassem").friends.list()).friends).toHaveLength(0);
    await w.as("amr").friends.request("carol");
    await w.as("amr").friends.remove("id-carol");
    expect((await w.as("carol").friends.list()).incoming).toHaveLength(0);
    await w.as("amr").friends.request("bassem");              // can ask again after a removal
  });
});

describe("limits", () => {
  it("twenty requests waiting is the most; an answer frees a place", async () => {
    const w = world();
    const names = Array.from({ length: MAX_WAITING + 1 }, (_, i) => `p${i}`);
    await meet(w, "amr", ...names);
    for (const n of names.slice(0, MAX_WAITING)) await w.as("amr").friends.request(n);
    await fails(w.as("amr").friends.request(names[MAX_WAITING]), "55000");
    await w.as("p0").friends.respond("id-amr", true);
    expect((await w.as("amr").friends.request(names[MAX_WAITING])).status).toBe("pending");
  });

  it("a hundred friends is the most", async () => {
    const w = world();
    const names = Array.from({ length: MAX_FRIENDS + 1 }, (_, i) => `f${i}`);
    await meet(w, "amr", ...names);
    for (const n of names.slice(0, MAX_FRIENDS)) await befriend(w, "amr", n);
    await fails(w.as("amr").friends.request(names[MAX_FRIENDS]), "55000");
    await w.as(names[MAX_FRIENDS]).friends.request("amr").then(() => { throw new Error("should not be possible"); }, (e) => expect(e.code).toBe("55000"));
  });
});

describe("invitations to a challenge", () => {
  async function room(w, { maxPlayers = 3, startMode = "together" } = {}) {
    const code = await w.as("amr").live.create({ title: "Duel", seconds: 20, maxPlayers, startMode, settings: {}, questions: QS });
    return code;
  }

  it("a member invites friends; a stranger and yourself are skipped; the friend sees it", async () => {
    const w = world(); await meet(w, "amr", "bassem", "carol");
    await befriend(w, "amr", "bassem");
    const code = await room(w);
    const r = await w.as("amr").friends.invite(code, ["id-bassem", "id-carol", "id-amr"]);
    expect(r.invited).toBe(1);
    expect(r.skipped).toEqual(expect.arrayContaining([{ id: "id-carol", reason: "not a friend" }, { id: "id-amr", reason: "you" }]));
    expect(await w.as("amr").friends.invitesSent(code)).toEqual(["id-bassem"]);
    const mine = await w.as("bassem").friends.myInvites();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ code, title: "Duel", from: "amr", question_count: 3, max_players: 3, players: 1 });
    expect(await w.as("bassem").friends.counts()).toEqual({ requests: 0, invites: 1 });
    expect(await w.as("carol").friends.myInvites()).toEqual([]);
  });

  it("only someone in the challenge can invite, and only while it can be joined", async () => {
    const w = world(); await meet(w, "amr", "bassem", "carol");
    await befriend(w, "amr", "bassem"); await befriend(w, "bassem", "carol");
    const code = await room(w);
    await fails(w.as("bassem").friends.invite(code, ["id-carol"]), "42501");
    await w.as("bassem").live.join(code);
    expect((await w.as("bassem").friends.invite(code, ["id-carol"])).invited).toBe(1);
    // Started ("together" mode) or finished: no more invitations.
    await w.as("amr").live.start(code);
    await fails(w.as("amr").friends.invite(code, ["id-carol"]), "55000");
    await w.as("amr").live.end(code);
    await fails(w.as("amr").friends.invite(code, ["id-carol"]), "55000");
  });

  it("dismissing, inviting again, and inviting twice", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    await befriend(w, "amr", "bassem");
    const code = await room(w);
    await w.as("amr").friends.invite(code, ["id-bassem"]);
    await w.as("bassem").friends.dismissInvite(code);
    expect(await w.as("bassem").friends.myInvites()).toEqual([]);
    expect((await w.as("amr").friends.invite(code, ["id-bassem"])).invited).toBe(1);
    const again = await w.as("amr").friends.invite(code, ["id-bassem"]);
    expect(again).toMatchObject({ invited: 0, skipped: [{ id: "id-bassem", reason: "already invited" }] });
  });

  it("joining clears the invitation; ending the friendship hides it; a full challenge isn't offered", async () => {
    const w = world(); await meet(w, "amr", "bassem", "carol");
    await befriend(w, "amr", "bassem"); await befriend(w, "amr", "carol");
    const code = await room(w, { maxPlayers: 2 });
    await w.as("amr").friends.invite(code, ["id-bassem", "id-carol"]);
    await w.as("bassem").live.join(code);                      // now 2 of 2
    expect(await w.as("bassem").friends.myInvites()).toEqual([]);   // joined
    expect(await w.as("carol").friends.myInvites()).toEqual([]);    // full
    const w2 = world(); await meet(w2, "amr", "bassem");
    await befriend(w2, "amr", "bassem");
    const code2 = await w2.as("amr").live.create({ title: "Again", seconds: 20, maxPlayers: 3, startMode: "together", settings: {}, questions: QS });
    await w2.as("amr").friends.invite(code2, ["id-bassem"]);
    expect(await w2.as("bassem").friends.myInvites()).toHaveLength(1);
    await w2.as("amr").friends.remove("id-bassem");
    expect(await w2.as("bassem").friends.myInvites()).toEqual([]);  // no longer a friend
  });

  it("an expired challenge isn't offered", async () => {
    const w = world(); await meet(w, "amr", "bassem");
    await befriend(w, "amr", "bassem");
    const code = await w.as("amr").live.create({ title: "Short", seconds: 20, maxPlayers: 3, startMode: "together", settings: {}, questions: QS, hours: 1 });
    await w.as("amr").friends.invite(code, ["id-bassem"]);
    expect(await w.as("bassem").friends.myInvites()).toHaveLength(1);
    w.tick(2 * 3600000);
    expect(await w.as("bassem").friends.myInvites()).toEqual([]);
  });
});
