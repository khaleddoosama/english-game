// @vitest-environment jsdom
// The challenge room (src/features/live/roomRules.js, useChallengeRoom): questions already shown are never taken back,
// the next question goes in its place, my own row until the server catches up, signals and presence, polling (20 s
// with a working channel, 4 s without, none after the end), the rematch check (8 s, for half an hour), the actions'
// busy state and messages, and opening a rematch. The Live API and the channel are faked; made-up players.
// Docs: docs/modules/live/challenge-room.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chan = vi.hoisted(() => ({ opened: [], last: null }));
vi.mock("../src/features/live/transport", () => ({
  openLiveChannel: (code, me, handlers) => {
    const ch = { code, me, handlers, sent: [], closed: false, send(event, payload) { ch.sent.push([event, payload]); }, close() { ch.closed = true; } };
    chan.opened.push(ch); chan.last = ch;
    return ch;
  },
}));
const R = await import("../src/features/live/roomRules");
const { useChallengeRoom } = await import("../src/features/live/useChallengeRoom");

const SAM = { id: "u-sam", name: "sam_01" }, ADA = "u-ada";
const row = (user_id, extra = {}) => ({ user_id, username: user_id, answered: 0, correct: 0, total_ms: 0, started_at: null, finished_at: null, ...extra });
const room = (extra = {}) => ({ code: "K7M2QX", state: "playing", member: true, host_id: ADA, questions: [{ prompt: "q1" }], players: [row(SAM.id), row(ADA)], settings: {}, ...extra });

describe("room rules", () => {
  it("a slower read never takes back questions already shown; after the end the server's list is used", () => {
    const cur = room({ questions: [{ prompt: "q1" }, { prompt: "q2" }] });
    expect(R.keepShown(cur, room({ questions: [{ prompt: "q1" }] })).questions).toEqual([{ prompt: "q1" }, { prompt: "q2" }]);
    expect(R.keepShown(cur, room({ questions: undefined })).questions).toEqual([{ prompt: "q1" }, { prompt: "q2" }]);
    expect(R.keepShown(cur, room({ state: "done", questions: [{ prompt: "q1" }] })).questions).toEqual([{ prompt: "q1" }]);
    expect(R.keepShown(cur, room({ code: "B2C3D4", questions: [] })).questions).toEqual([]);
    expect(R.keepShown(null, room())).toEqual(room());
  });

  it("the next question goes in its place, unless it is there already", () => {
    expect(R.withQuestion(room(), 1, { prompt: "q2" }).questions).toEqual([{ prompt: "q1" }, { prompt: "q2" }]);
    expect(R.withQuestion(room(), 0, { prompt: "other" })).toBe(null);
    expect(R.withQuestion(null, 1, { prompt: "q2" })).toBe(null);
    expect(R.withQuestion(room(), 1, null)).toBe(null);
  });

  it("a progress signal updates that player's row unless it is older", () => {
    const cur = room({ players: [row(SAM.id), row(ADA, { answered: 3 })] });
    expect(R.withProgress(cur, { user_id: ADA, answered: 4, correct: 2 }).players[1]).toMatchObject({ answered: 4, correct: 2 });
    expect(R.withProgress(cur, { user_id: ADA, answered: 2 }).players[1].answered).toBe(3);
    expect(R.withProgress(cur, { user_id: ADA, answered: 3, correct: 1 }).players[1].correct).toBe(1);
  });

  it("someone present who is not in the list", () => {
    expect(R.someoneNew(room(), [{ id: SAM.id }, { id: ADA }])).toBe(false);
    expect(R.someoneNew(room(), [{ id: "u-new" }])).toBe(true);
    expect(R.someoneNew(null, [{ id: SAM.id }])).toBe(true);
  });

  it("my row: the answer's while it has answered more than the server's", () => {
    const v = room({ players: [row(SAM.id, { answered: 2, correct: 1 })] });
    expect(R.myRow(v, SAM.id, { answered: 3, correct: 2 })).toMatchObject({ answered: 3, correct: 2, username: SAM.id });
    expect(R.myRow(v, SAM.id, { answered: 2, correct: 9 })).toMatchObject({ answered: 2, correct: 1 });
    expect(R.myRow(v, "u-none", { answered: 9 })).toBe(null);
    expect(R.progressSignal(SAM.id, { answered: 3, correct: 2, total_ms: 900, finished_at: null, started_at: "t", extra: 1 })).toEqual({ user_id: SAM.id, answered: 3, correct: 2, total_ms: 900, finished_at: null, started_at: "t" });
  });

  it("polling and the rematch check", () => {
    expect([R.roomPollMs("live"), R.roomPollMs("connecting"), R.roomPollMs("offline")]).toEqual([20000, 4000, 4000]);
    const now = Date.parse("2026-10-19T12:00:00Z");
    const done = (extra) => room({ state: "done", ended_at: "2026-10-19T11:50:00Z", ...extra });
    expect(R.watchesRematch(done(), now)).toBe(true);
    expect(R.watchesRematch(done({ ended_at: "2026-10-19T11:20:00Z" }), now)).toBe(false);
    expect(R.watchesRematch(done({ settings: { next_code: "B2C3D4" } }), now)).toBe(false);
    expect(R.watchesRematch(done({ member: false }), now)).toBe(false);
    expect(R.watchesRematch(room(), now)).toBe(false);
    expect(R.watchesRematch(done({ ended_at: null, expires_at: null }), now)).toBe(true);
  });

  it("which screen", () => {
    expect(R.roomScreen(room({ member: false }), null)).toBe("invite");
    expect(R.roomScreen(room({ state: "lobby" }), row(SAM.id))).toBe("lobby");
    expect(R.roomScreen(room({ state: "done" }), row(SAM.id))).toBe("results");
    expect(R.roomScreen(room(), row(SAM.id))).toBe("ready");
    expect(R.roomScreen(room(), row(SAM.id, { started_at: "t" }))).toBe("play");
    expect(R.roomScreen(room(), row(SAM.id, { started_at: "t", finished_at: "t" }))).toBe("waiting");
  });
});

describe("useChallengeRoom", () => {
  let root, host, out;
  function Probe(props) { out = useChallengeRoom(props); return null; }
  const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
  const mount = async (props) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Probe {...props} />)); };
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  beforeEach(() => { vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true; chan.opened = []; chan.last = null; });
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; vi.useRealTimers(); });

  it("loads; the first failed read is shown, a later one keeps the screen", async () => {
    const api = { view: vi.fn(async () => { throw new Error("No challenge with that code."); }) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    expect([out.view, out.loadError]).toEqual([null, "No challenge with that code."]);
    await act(async () => root.unmount()); root = undefined;
    api.view = vi.fn(async () => room());
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    expect([out.view.code, out.loadError]).toEqual(["K7M2QX", null]);
    api.view = vi.fn(async () => { throw new Error("offline"); });
    await act(async () => { await out.refresh(); });
    expect([out.view.code, out.loadError]).toEqual(["K7M2QX", null]);
  });

  it("a member opens the channel and says joined; a non-member does not; closing on leaving the room", async () => {
    const api = { view: vi.fn(async () => room({ member: false })) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    expect(chan.opened).toHaveLength(0);
    api.view = vi.fn(async () => room());
    await act(async () => { await out.refresh(); });
    expect(chan.opened).toHaveLength(1);
    expect([chan.last.code, chan.last.me, chan.last.sent]).toEqual(["K7M2QX", SAM, [["joined", { user_id: SAM.id }]]]);
    await act(async () => root.unmount()); root = undefined;
    expect(chan.last.closed).toBe(true);
  });

  it("signals: progress updates a row (and reads again when that player finished); others read again; presence", async () => {
    const api = { view: vi.fn(async () => room()) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    const reads = () => api.view.mock.calls.length;
    const before = reads();
    await act(async () => { chan.last.handlers.onEvent("progress", { user_id: ADA, answered: 1, correct: 1 }); });
    expect([out.view.players[1].answered, reads()]).toEqual([1, before]);
    await act(async () => { chan.last.handlers.onEvent("progress", { user_id: ADA, answered: 3, finished_at: "t" }); await vi.advanceTimersByTimeAsync(0); });
    expect(reads()).toBe(before + 1);
    await act(async () => { chan.last.handlers.onEvent("rematch", { next_code: "B2C3D4" }); await vi.advanceTimersByTimeAsync(0); });
    expect(reads()).toBe(before + 2);
    await act(async () => { chan.last.handlers.onPresence([{ id: SAM.id }, { id: ADA }]); });
    expect([out.online, reads()]).toEqual([[SAM.id, ADA], before + 2]);
    await act(async () => { chan.last.handlers.onPresence([{ id: "u-new" }]); await vi.advanceTimersByTimeAsync(0); });
    expect(reads()).toBe(before + 3);
  });

  it("polls every 20 s with a working channel, every 4 s without, and not after the end", async () => {
    const api = { view: vi.fn(async () => room()) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    const reads = () => api.view.mock.calls.length;
    let n = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(reads()).toBe(n + 1);
    await act(async () => { chan.last.handlers.onStatus("live"); });
    n = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(19999); });
    expect(reads()).toBe(n);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(reads()).toBe(n + 1);
    api.view = vi.fn(async () => room({ state: "done", ended_at: new Date().toISOString(), settings: { next_code: "B2C3D4" } }));
    await act(async () => { await out.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(api.view.mock.calls.length).toBe(1);
  });

  it("a finished room checks for a rematch every 8 s until one is linked", async () => {
    const api = { view: vi.fn(async () => room({ state: "done", ended_at: new Date().toISOString() })) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    const n = api.view.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.view.mock.calls.length).toBe(n + 1);
    api.view.mockResolvedValue(room({ state: "done", ended_at: new Date().toISOString(), settings: { next_code: "B2C3D4" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    const m = api.view.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(40000); });
    expect(api.view.mock.calls.length).toBe(m);
  });

  it("questions already shown stay; the next one from an answer goes in; my row from the answer", async () => {
    const api = { view: vi.fn(async () => room({ questions: [{ prompt: "q1" }] })) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    await act(async () => { out.addQuestion(1, { prompt: "q2" }); });
    await act(async () => { await out.refresh(); });
    expect(out.view.questions.map((q) => q.prompt)).toEqual(["q1", "q2"]);
    await act(async () => { out.setLocalMe(row(SAM.id, { answered: 1, correct: 1, started_at: "t" })); });
    expect(out.me).toMatchObject({ answered: 1, correct: 1 });
    expect(out.isHost).toBe(false);
  });

  it("an action: busy while it runs, the returned challenge shown, then `after`; a failure's message", async () => {
    const api = { view: vi.fn(async () => room({ state: "lobby" })) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    const hold = later(), after = vi.fn();
    let running;
    await act(async () => { running = out.act(() => hold.promise, after); });
    expect(out.busy).toBe(true);
    await act(async () => { hold.resolve(room({ state: "playing", title: "returned" })); await running; });
    expect([out.busy, out.view.title, after.mock.calls.length, out.error]).toEqual([false, "returned", 1, null]);
    await act(async () => { await out.act(async () => { throw new Error("This challenge has already started."); }, after); });
    expect([out.busy, out.error, after.mock.calls.length]).toEqual([false, "This challenge has already started.", 1]);
    await act(async () => { out.send("start"); });
    expect(chan.last.sent.at(-1)).toEqual(["start", {}]);
  });

  it("opening a rematch: joins it first unless I made it", async () => {
    const api = { view: vi.fn(async () => room({ state: "done" })), join: vi.fn(async () => { throw new Error("full"); }) };
    await mount({ api, code: "K7M2QX", player: SAM }); await flush();
    const onOpen = vi.fn();
    await act(async () => { await out.openNext("B2C3D4", false, onOpen); });
    expect([api.join.mock.calls, onOpen.mock.calls, out.busy]).toEqual([[["B2C3D4"]], [["B2C3D4"]], false]);
    await act(async () => { await out.openNext("C3D4E5", true, onOpen); });
    expect([api.join.mock.calls.length, onOpen.mock.calls.at(-1)]).toEqual([1, ["C3D4E5"]]);
  });
});
