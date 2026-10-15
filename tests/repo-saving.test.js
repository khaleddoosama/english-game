// How the repo (src/lib/repo.js) saves progress when things go wrong: the
// network fails, saves pile up, the page closes, the user comes back. Written
// before repo.js was split into parts, to keep the behaviour while it moves.
// The database is the in-memory fake (tests/fakeSupabase.js); the same
// scenarios against real PostgreSQL are in tests/integration/progress-devices.test.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map());
vi.mock("../src/lib/idb", () => ({ idb: {
  get: async (k) => cache.get(k),
  set: async (k, v) => { cache.set(k, structuredClone(v)); return true; },
  del: async (k) => { cache.delete(k); return true; },
} }));

import { createSupabaseRepo } from "../src/lib/repo";
import { createFakeSupabase } from "./fakeSupabase";

const state = (score, extra = {}) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [], ...extra });
const snapshot = () => cache.get("progress:u1");
const repos = [];
const open = (fake, over = {}) => { const r = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake, ...over }); repos.push(r); return r; };
const failSaves = (fake, how = "offline") => {
  const original = fake.rpc.bind(fake);
  fake.rpc = async (name, args) => {
    if (name !== "save_progress_v2") return original(name, args);
    fake.calls.push({ rpc: name, args: structuredClone(args) });          // the attempt is counted, though it never arrives
    return { data: null, error: { message: how } };
  };
  return () => { fake.rpc = original; };
};
const saveCalls = (fake) => fake.calls.filter((c) => c.rpc === "save_progress_v2");

beforeEach(() => { cache.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { repos.splice(0).forEach((r) => r.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the network fails", () => {
  it("the state is kept on the device, the status says error, and nothing stops the next save", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    const seen = []; repo.status.subscribe((s) => seen.push(s));
    await repo.loadProgress();
    const restore = failSaves(fake);
    await repo.saveProgress(state(10));
    expect(repo.status.get()).toBe("error");
    expect(snapshot()).toMatchObject({ dirty: true, data: { score: 10 } });
    expect(fake.tables.progress).toEqual([]);
    restore();
    await repo.saveProgress(state(20));
    expect(repo.status.get()).toBe("saved");
    expect(snapshot()).toMatchObject({ dirty: false, data: { score: 20 } });
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(20);
    expect(seen).toEqual(expect.arrayContaining(["saving", "error", "saved"]));
  });

  it("it tries again by itself after 15 seconds, once the network is back", async () => {
    vi.useFakeTimers();
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    const restore = failSaves(fake);
    await repo.saveProgress(state(10));
    expect(saveCalls(fake)).toHaveLength(1);
    restore();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(saveCalls(fake)).toHaveLength(1);                         // not yet
    await vi.advanceTimersByTimeAsync(1_500);
    expect(saveCalls(fake)).toHaveLength(2);
    expect(repo.status.get()).toBe("saved");
    expect(snapshot()).toMatchObject({ dirty: false, data: { score: 10 } });
  });

  it("while it keeps failing it keeps trying, every 15 seconds, with the newest state only", async () => {
    vi.useFakeTimers();
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    failSaves(fake);
    await repo.saveProgress(state(10));
    await repo.saveProgress(state(20));
    const before = saveCalls(fake).length;
    await vi.advanceTimersByTimeAsync(15_100);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(saveCalls(fake).length).toBe(before + 2);
    expect(saveCalls(fake).at(-1).args.p_sections.core.score).toBe(20);
    expect(repo.status.get()).toBe("error");
  });

  it("disposing the repo stops the retries", async () => {
    vi.useFakeTimers();
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    failSaves(fake);
    await repo.saveProgress(state(10));
    const before = saveCalls(fake).length;
    repo.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saveCalls(fake).length).toBe(before);
  });

  it("the browser's 'online' event sends what is waiting; and a device that knows it is offline says offline", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    vi.stubGlobal("navigator", { onLine: false });
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    const restore = failSaves(fake);
    await repo.saveProgress(state(10));
    expect(repo.status.get()).toBe("offline");
    restore();
    const before = saveCalls(fake).length;
    win.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(saveCalls(fake).length).toBe(before + 1));
    await vi.waitFor(() => expect(repo.status.get()).toBe("saved"));
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(10);
  });

  it("a server that refuses (an error answer, not a lost connection) is handled the same way", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    failSaves(fake, "permission denied");
    await repo.saveProgress(state(10));
    expect(repo.status.get()).toBe("error");
    expect(snapshot().dirty).toBe(true);
  });
});

describe("saves pile up", () => {
  it("while one is on its way, the ones after it become one: only the newest is sent next", async () => {
    const fake = createFakeSupabase();
    const original = fake.rpc.bind(fake);
    const gates = [];
    fake.rpc = (name, args) => (name === "save_progress_v2" ? new Promise((resolve) => gates.push(() => resolve(original(name, args)))) : original(name, args));
    const repo = open(fake);
    await repo.loadProgress();
    const first = repo.saveProgress(state(10));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const rest = [20, 30, 40, 50].map((n) => repo.saveProgress(state(n)));
    gates[0]();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]();
    await Promise.all([first, ...rest]);
    const sent = saveCalls(fake).map((c) => c.args.p_sections.core.score);
    expect(sent).toEqual([10, 50]);
    expect(snapshot()).toMatchObject({ dirty: false, data: { score: 50 } });
  });

  it("nothing is sent when nothing changed", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    await repo.saveProgress(state(10));
    const n = saveCalls(fake).length;
    await repo.saveProgress(state(10));
    expect(saveCalls(fake).length).toBe(n);
  });
});

describe("the page closes", () => {
  it("while a save is on its way: the next visit finds the state on the device and sends it", async () => {
    const fake = createFakeSupabase();
    const first = open(fake);
    await first.loadProgress();
    await first.saveProgress(state(10));
    fake.rpc = () => new Promise(() => {});                        // the connection never answers; the tab is closed
    void first.saveProgress(state(30));
    await vi.waitFor(() => expect(snapshot()).toMatchObject({ dirty: true, data: { score: 30 } }));
    first.dispose();
    const second = open(createFakeSupabase({ tables: fake.tables }));
    const loaded = await second.loadProgress();
    expect(loaded.score).toBe(30);                                  // the device's copy, merged with the server's
    await second.saveProgress(loaded);
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(30);
    expect(snapshot()).toMatchObject({ dirty: false });
  });

  it("a visit with no connection plays from the device copy", async () => {
    const fake = createFakeSupabase();
    const first = open(fake);
    await first.loadProgress();
    await first.saveProgress(state(10));
    first.dispose();
    const offline = createFakeSupabase();
    offline.from = () => { throw new Error("offline"); };
    const second = open(offline);
    expect((await second.loadProgress()).score).toBe(10);
    expect(second.status.get()).toBe("offline");
  });
});

describe("two devices", () => {
  it("the second one to save merges with the first instead of overwriting it, and says so", async () => {
    const fake = createFakeSupabase();
    const a = open(fake);
    await a.loadProgress(); await a.saveProgress(state(100));
    const b = open(fake);
    await b.loadProgress();
    const merged = []; b.onMerged((d) => merged.push(d));
    await a.saveProgress(state(150));
    await b.saveProgress(state(130));
    expect(merged).toHaveLength(1);
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(180);   // 100 + 50 + 30
  });

  it("a device coming back to the foreground takes the other's progress in, and then has nothing new", async () => {
    const fake = createFakeSupabase();
    const a = open(fake);
    await a.loadProgress(); await a.saveProgress(state(100));
    const b = open(fake);
    await b.loadProgress();
    await a.saveProgress(state(150));
    const told = []; b.onMerged((d) => told.push(d));
    expect(await b.refreshProgress()).toBe(true);
    expect(told[0].score).toBe(150);
    expect(await b.refreshProgress()).toBe(false);
  });

  it("refresh does not run while this device is saving", async () => {
    const fake = createFakeSupabase();
    const a = open(fake);
    await a.loadProgress(); await a.saveProgress(state(100));
    const original = fake.rpc.bind(fake);
    let release;
    fake.rpc = (name, args) => (name === "save_progress_v2" ? new Promise((resolve) => { release = () => resolve(original(name, args)); }) : original(name, args));
    const pending = a.saveProgress(state(120));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await a.refreshProgress()).toBe(false);
    release(); await pending;
  });
});

describe("a reset", () => {
  it("clears the server and the device, and the next load finds nothing", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress(); await repo.saveProgress(state(100, { mastery: { Word: { total: 2, correct: 1 } } }));
    await repo.resetProgress();
    expect(fake.tables.progress).toEqual([]);
    expect(fake.tables.mastery).toEqual([]);
    expect(snapshot()).toBeUndefined();
    expect(await open(fake).loadProgress()).toBeNull();
  });

  it("a save after a reset starts again from nothing, not from the old revisions", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress(); await repo.saveProgress(state(100));
    await repo.resetProgress();
    await repo.saveProgress(state(5));
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(5);
  });
});

describe("the connection is lost after the server has already saved", () => {
  // The save reaches the database and the page closes (or the answer never
  // comes back) before the device knows. The next visit still has the unsent
  // copy; it must not count the same play twice.
  const lostAnswer = (fake) => {
    const original = fake.rpc.bind(fake);
    fake.rpc = async (name, args) => { const out = await original(name, args); if (name === "save_progress_v2") throw new Error("connection lost after the server saved it"); return out; };
    return () => { fake.rpc = original; };
  };

  it("the score and the counters are not added twice when the device comes back", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    await repo.saveProgress(state(100));
    lostAnswer(fake);
    await repo.saveProgress(state(150));
    repo.dispose();
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(150);   // the server did get it
    const again = createFakeSupabase({ tables: fake.tables });
    const reopened = open(again);
    const loaded = await reopened.loadProgress();
    expect(loaded.score).toBe(150);
    expect(loaded.attempted).toBe(15);
    await reopened.saveProgress(loaded);
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(150);
  });

  it("rounds in the history are not duplicated either", async () => {
    const fake = createFakeSupabase();
    const repo = open(fake);
    await repo.loadProgress();
    await repo.saveProgress(state(100, { sessionLogs: [{ id: "r1", at: 1 }] }));
    lostAnswer(fake);
    await repo.saveProgress(state(150, { sessionLogs: [{ id: "r2", at: 2 }, { id: "r1", at: 1 }] }));
    repo.dispose();
    const reopened = open(createFakeSupabase({ tables: fake.tables }));
    expect((await reopened.loadProgress()).sessionLogs.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("a copy that really was never sent is still merged with what another device did meanwhile", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    const tablet = open(fake);
    await tablet.loadProgress();
    await tablet.saveProgress(state(150));                                  // saved by the other device
    fake.rpc = () => new Promise(() => {});                                   // the phone's save never gets out
    void phone.saveProgress(state(130));
    await vi.waitFor(() => expect(snapshot()).toMatchObject({ dirty: true, data: { score: 130 } }));
    phone.dispose();
    const reopened = open(createFakeSupabase({ tables: fake.tables }));
    expect((await reopened.loadProgress()).score).toBe(180);                  // 100 + 50 from the tablet + 30 from the phone
  });
});
