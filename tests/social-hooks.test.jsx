// @vitest-environment jsdom
// The social hooks (src/features/social): useSocial (the friends API for the player, the Live API asked for only in
// local mode, the badge counts), useLeaderboard (the chosen tab's rows, a late answer for another tab dropped, the
// Friends tab), useFriendsList (the Friends page's actions, messages and busy state) and useLiveHistory. The
// leaderboard reads and Supabase are faked. Made-up players. Docs: docs/modules/social/friends-and-ranks.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ local: false, client: null, reads: null }));
vi.mock("../src/lib/supabase", () => ({ get isLocalMode() { return env.local; }, get supabase() { return env.client; } }));
vi.mock("../src/features/social/socialApi", () => ({
  fetchLeaderboard: (kind) => env.reads.board(kind),
  fetchFriendsBoard: (ids) => env.reads.friends(ids),
  fetchLiveHistory: (id) => env.reads.history(id),
}));
const { useLeaderboard } = await import("../src/features/social/useLeaderboard");
const { useFriendsList } = await import("../src/features/social/useFriendsList");
const { useLiveHistory } = await import("../src/features/social/useLiveHistory");

const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
let root, host, out;
const mount = async (el) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(el)); };
const rerender = (el) => act(async () => root.render(el));
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; env.local = false; env.client = null; localStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; vi.resetModules(); });

describe("useSocial", () => {
  // getFriendsApi keeps one API per page, so each test loads the module fresh.
  const load = async () => (await import("../src/features/social/useSocial")).useSocial;
  function Probe({ hook, args }) { out = hook(args); return null; }
  const SAM = { id: "u-sam", name: "sam_01" };

  it("online: the database's counts become the badges; the Live API is not asked for", async () => {
    const useSocial = await load();
    const calls = [];
    env.client = { rpc: async (fn) => { calls.push(fn); return { data: { requests: 2, invites: 4 }, error: null }; } };
    const liveFor = vi.fn();
    await mount(<Probe hook={useSocial} args={{ player: SAM, enabled: true, liveFor }} />); await tick();
    expect([out.friendsApi.mode, out.counts, out.badges, liveFor.mock.calls.length]).toEqual(["online", { requests: 2, invites: 4 }, { live: 4, profile: 2 }, 0]);
    expect(calls).toEqual(["social_counts"]);
  });

  it("not counted before the game has loaded", async () => {
    const useSocial = await load();
    const rpc = vi.fn(async () => ({ data: { requests: 1, invites: 1 }, error: null }));
    env.client = { rpc };
    await mount(<Probe hook={useSocial} args={{ player: SAM, enabled: false, liveFor: vi.fn() }} />); await tick();
    expect([out.counts, out.badges, rpc.mock.calls.length]).toEqual([{ requests: 0, invites: 0 }, { live: 0, profile: 0 }, 0]);
  });

  it("local mode: the friends API gets the Live API for this player, and counts the requests in this browser", async () => {
    env.local = true;
    const useSocial = await load();
    localStorage.setItem("friends1:p:u-lina|u-sam", JSON.stringify({ a: "u-lina", b: "u-sam", by: "u-lina", status: "pending", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }));
    const live = { view: vi.fn() };
    const liveFor = vi.fn(() => live);
    await mount(<Probe hook={useSocial} args={{ player: SAM, enabled: true, liveFor }} />); await tick();
    expect(liveFor).toHaveBeenCalledTimes(1);
    expect(liveFor.mock.calls[0][0]()).toEqual(SAM);
    expect([out.friendsApi.mode, out.counts, out.badges]).toEqual(["local", { requests: 1, invites: 0 }, { live: 0, profile: 1 }]);
  });
});

describe("useLeaderboard", () => {
  function Probe({ tab, me, api }) { out = useLeaderboard(tab, me, api); return null; }

  it("reads the chosen tab; an answer for a tab no longer chosen is dropped", async () => {
    const asks = {};
    env.reads = { board: (kind) => { asks[kind] = later(); return asks[kind].promise; } };
    await mount(<Probe tab="week" me="u-sam" api={null} />);
    expect(out).toEqual({ rows: null, error: null });
    await rerender(<Probe tab="all" me="u-sam" api={null} />);
    await act(async () => { asks.week.resolve([{ id: "late" }]); });
    expect(out.rows).toBe(null);
    await act(async () => { asks.all.resolve([{ id: "u-tariq" }]); });
    expect(out.rows).toEqual([{ id: "u-tariq" }]);
  });

  it("the Friends tab reads the friends list, then the player's and the friends' rows", async () => {
    const asked = [];
    env.reads = { friends: async (ids) => { asked.push(ids); return [{ id: "u-omar" }, { id: "u-sam" }]; } };
    const api = { list: async () => ({ friends: [{ id: "u-omar" }, { id: "u-zed" }], incoming: [], outgoing: [] }) };
    await mount(<Probe tab="friends" me="u-sam" api={api} />); await tick();
    expect(asked).toEqual([["u-sam", "u-omar", "u-zed"]]);
    expect(out.rows).toEqual([{ id: "u-omar" }, { id: "u-sam" }]);
  });

  it("a failed read gives its message", async () => {
    env.reads = { board: async () => { throw new Error("The database is resting."); } };
    await mount(<Probe tab="live" me="u-sam" api={null} />); await tick();
    expect(out).toEqual({ rows: null, error: "The database is resting." });
  });
});

describe("useFriendsList", () => {
  function Probe({ api, onChanged }) { out = useFriendsList(api, onChanged); return null; }
  const LIST = { friends: [{ id: "u-omar", username: "omar_k" }], incoming: [{ id: "u-lina", username: "lina_p" }], outgoing: [{ id: "u-kai", username: "kai_m" }] };
  const fakeApi = (over = {}) => ({ list: vi.fn(async () => LIST), request: vi.fn(), respond: vi.fn(async () => {}), remove: vi.fn(async () => {}), ...over });

  it("reads the list on open; a failed read gives its message and keeps the list", async () => {
    const api = fakeApi();
    await mount(<Probe api={api} onChanged={vi.fn()} />); await tick();
    expect([out.data, out.loadError]).toEqual([LIST, null]);
    api.list.mockRejectedValueOnce(new Error("You're offline. Friends need a connection."));
    await act(async () => { await out.decline({ id: "u-lina", username: "lina_p" }); });
    expect([out.data, out.loadError]).toEqual([LIST, "You're offline. Friends need a connection."]);
  });

  it("a request: the message from the answer, the list read again, the badges counted again", async () => {
    const onChanged = vi.fn();
    const api = fakeApi({ request: vi.fn(async () => ({ status: "pending", id: "u-noor", username: "noor_a" })) });
    await mount(<Probe api={api} onChanged={onChanged} />); await tick();
    let ok;
    await act(async () => { ok = await out.request(" Noor_A "); });
    expect(api.request).toHaveBeenCalledWith(" Noor_A ");
    expect([ok, out.notice, api.list.mock.calls.length, onChanged.mock.calls.length]).toEqual([true, { kind: "ok", text: "Request sent to noor_a. They'll see it next time they open the game." }, 2, 1]);
    api.request.mockResolvedValueOnce({ status: "accepted", id: "u-lina", username: "lina_p" });
    await act(async () => { await out.request("lina_p"); });
    expect(out.notice).toEqual({ kind: "ok", text: "You and lina_p are friends now." });
  });

  it("a refusal: the server's message, false, nothing counted again", async () => {
    const onChanged = vi.fn();
    const api = fakeApi({ request: vi.fn(async () => { throw new Error("You already asked noor_a. Waiting for them to answer."); }) });
    await mount(<Probe api={api} onChanged={onChanged} />); await tick();
    let ok;
    await act(async () => { ok = await out.request("noor_a"); });
    expect([ok, out.notice, onChanged.mock.calls.length]).toEqual([false, { kind: "error", text: "You already asked noor_a. Waiting for them to answer." }, 0]);
    await act(async () => out.clearNotice());
    expect(out.notice).toBe(null);
  });

  it("accept, decline, remove and cancel: the right call and message; busy while running; Sure? is cleared", async () => {
    const hold = later();
    const api = fakeApi({ remove: vi.fn(() => hold.promise) });
    await mount(<Probe api={api} onChanged={vi.fn()} />); await tick();
    await act(async () => { await out.accept({ id: "u-lina", username: "lina_p" }); });
    expect([api.respond.mock.calls.at(-1), out.notice.text]).toEqual([["u-lina", true], "You and lina_p are friends now."]);
    await act(async () => { await out.decline({ id: "u-lina", username: "lina_p" }); });
    expect([api.respond.mock.calls.at(-1), out.notice]).toEqual([["u-lina", false], null]);
    await act(async () => out.askSure("u-omar"));
    expect(out.sure).toBe("u-omar");
    let removing;
    await act(async () => { removing = out.remove({ id: "u-omar", username: "omar_k" }); });
    expect([out.busy, out.sure, api.remove.mock.calls.at(-1)]).toEqual(["rm-u-omar", null, ["u-omar"]]);
    await act(async () => { hold.resolve(); await removing; });
    expect([out.busy, out.notice.text]).toEqual([null, "omar_k is no longer your friend."]);
    api.remove.mockResolvedValueOnce();
    await act(async () => { await out.cancel({ id: "u-kai", username: "kai_m" }); });
    expect([api.remove.mock.calls.at(-1), out.notice.text]).toEqual([["u-kai"], "Request taken back."]);
  });
});

describe("useLiveHistory", () => {
  function Probe({ id }) { out = useLiveHistory(id); return null; }
  const ROWS = [{ room_code: "K7M2QX", title: "Weather words" }];

  it("the player's rows; null while they load", async () => {
    const ask = later();
    const asked = [];
    env.reads = { history: (id) => { asked.push(id); return ask.promise; } };
    await mount(<Probe id="u-sam" />);
    expect([out, asked]).toEqual([null, ["u-sam"]]);
    await act(async () => { ask.resolve(ROWS); });
    expect(out).toEqual(ROWS);
  });

  it("none in local mode, without a player, or when the read fails", async () => {
    env.reads = { history: vi.fn(async () => { throw new Error("offline"); }) };
    await mount(<Probe id="u-sam" />); await tick();
    expect(out).toEqual([]);
    await rerender(<Probe id={undefined} />); await tick();
    expect(out).toEqual([]);
    env.local = true;
    await rerender(<Probe id="u-ada" />); await tick();
    expect([out, env.reads.history.mock.calls.length]).toEqual([[], 1]);
  });
});
