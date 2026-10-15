// A progress save carries an operation id, so a save the database already has is
// never applied a second time (migration 0042). These tests are about the client:
// how long it keeps an id, what it does when the answer is lost, when the page is
// closed, and against a database that does not know ids yet. The database side is
// tested in tests/integration/progress-ops.test.js; the database here is the fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map());
vi.mock("../src/lib/idb", () => ({ idb: {
  get: async (k) => cache.get(k),
  set: async (k, v) => { cache.set(k, structuredClone(v)); return true; },
  del: async (k) => { cache.delete(k); return true; },
} }));

import { createSupabaseRepo } from "../src/lib/repo";
import { createFakeSupabase } from "./fakeSupabase";

const state = (score) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [] });
const snapshot = () => cache.get("progress:u1");
const repos = [];
const open = (fake) => { const r = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake }); repos.push(r); return r; };
const saves = (fake) => fake.calls.filter((c) => c.rpc === "save_progress_v2");
const core = (fake) => fake.tables.progress.find((r) => r.section === "core").data;
// The database gets the save, the answer never comes back.
const loseAnswers = (fake) => {
  const original = fake.rpc.bind(fake);
  const state = { on: true };
  fake.rpc = async (name, args) => { const out = await original(name, args); if (name === "save_progress_v2" && state.on) throw new Error("connection lost after the server saved it"); return out; };
  return state;
};

beforeEach(() => { cache.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { repos.splice(0).forEach((r) => r.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });

// The phone saves 100 -> 150 and the answer is lost; the tablet, which knew only 100, plays on to 130.
async function lostAnswerThenOtherDevice() {
  const fake = createFakeSupabase();
  const phone = open(fake);
  await phone.loadProgress(); await phone.saveProgress(state(100));
  const tabletFake = createFakeSupabase({ tables: fake.tables });
  const tablet = open(tabletFake);
  await tablet.loadProgress();
  const lost = loseAnswers(fake);
  await phone.saveProgress(state(150));
  expect(core(fake).score).toBe(150);
  await tablet.saveProgress(state(130));
  expect(core(fake).score).toBe(180);
  return { fake, phone, tablet, lost };
}

describe("a save whose answer was lost", () => {
  it("is not counted twice when the same device sends it again after another device saved", async () => {
    const { fake, phone, lost } = await lostAnswerThenOtherDevice();
    lost.on = false;
    await phone.saveProgress(state(150));
    expect(core(fake)).toMatchObject({ score: 180, attempted: 18 });
    expect(fake.tables.profiles[0].score).toBe(180);
  });

  it("keeps its id for every retry, and the retry is that same save", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    const lost = loseAnswers(fake);
    await phone.saveProgress(state(150));
    lost.on = false;
    await phone.saveProgress(state(150));
    const [, first, retry] = saves(fake);
    expect(first.args.p_op).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry.args).toEqual(first.args);                       // same id, same content, same expected revisions
  });

  it("a new save gets a new id", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress();
    await phone.saveProgress(state(100)); await phone.saveProgress(state(150)); await phone.saveProgress(state(190));
    const ids = saves(fake).map((c) => c.args.p_op);
    expect(new Set(ids).size).toBe(3);
    expect(core(fake).score).toBe(190);
  });

  it("is first resolved, then the newer play follows on top of it: nothing is lost and nothing counted twice", async () => {
    const { fake, phone, lost } = await lostAnswerThenOtherDevice();
    lost.on = false;
    await phone.saveProgress(state(160));                          // the player kept playing (150 -> 160) before the retry
    expect(core(fake)).toMatchObject({ score: 190, attempted: 19 });   // 100 + 50 + 30 + 10
  });

  it("is remembered on the device while it is unanswered, and forgotten once the server confirmed it", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    expect(snapshot()).toMatchObject({ dirty: false });
    expect(snapshot().inflight).toBeUndefined();
    const lost = loseAnswers(fake);
    await phone.saveProgress(state(150));
    expect(snapshot()).toMatchObject({ dirty: true, inflight: { op: saves(fake).at(-1).args.p_op } });
    lost.on = false;
    await phone.saveProgress(state(150));
    expect(snapshot()).toMatchObject({ dirty: false });
    expect(snapshot().inflight).toBeUndefined();
  });

  it("is resolved first when the page is opened again, before anything is merged", async () => {
    const { fake, phone, tablet } = await lostAnswerThenOtherDevice();
    phone.dispose(); tablet.dispose();
    const sent = saves(fake).at(-3).args.p_op;                     // the phone's lost save (the tablet's came after it)
    const again = createFakeSupabase({ tables: fake.tables });
    const reopened = open(again);
    const loaded = await reopened.loadProgress();
    expect(saves(again)[0].args.p_op).toBe(sent);                  // the first thing the new page did was ask again about that save
    expect(loaded).toMatchObject({ score: 180, attempted: 18 });
    await reopened.saveProgress(loaded);
    expect(core(fake)).toMatchObject({ score: 180, attempted: 18 });
    expect(snapshot().inflight).toBeUndefined();
  });

  it("when it never reached the database, the retry applies it (the same id, now for the first time)", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    const original = fake.rpc.bind(fake);
    let down = true;
    fake.rpc = async (name, args) => { if (name === "save_progress_v2" && down) throw new Error("offline"); return original(name, args); };
    await phone.saveProgress(state(150));
    expect(core(fake).score).toBe(100);
    down = false;
    await phone.saveProgress(state(150));
    expect(core(fake)).toMatchObject({ score: 150, attempted: 15 });
    expect(fake.tables.progress_ops).toHaveLength(2);
  });

  it("when the database refused it for a stale revision, nothing stays pending and the merge works as before", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    const tablet = open(createFakeSupabase({ tables: fake.tables }));
    await tablet.loadProgress(); await tablet.saveProgress(state(150));
    await phone.saveProgress(state(130));                           // conflict, merged: 100 + 50 + 30
    expect(core(fake).score).toBe(180);
    expect(snapshot().inflight).toBeUndefined();
  });
});

describe("a database that does not know operation ids yet (migration 0042 not applied)", () => {
  const oldServer = (fake) => {
    const original = fake.rpc.bind(fake);
    fake.rpc = async (name, args) => {
      if (name === "save_progress_v2" && "p_op" in args) { fake.calls.push({ rpc: name, args: structuredClone(args) }); return { data: null, error: { code: "PGRST202", message: "Could not find the function public.save_progress_v2(p_expected, p_mastery, p_mastery_removes, p_op, p_profile, p_replace, p_sections) in the schema cache" } }; }
      const { p_op, ...rest } = args ?? {};
      return original(name, name === "save_progress_v2" ? rest : args);
    };
  };

  it("the save still goes through without an id, and the client stops sending ids", async () => {
    const fake = createFakeSupabase();
    oldServer(fake);
    const phone = open(fake);
    await phone.loadProgress();
    await phone.saveProgress(state(100));
    await phone.saveProgress(state(150));
    expect(core(fake)).toMatchObject({ score: 150, attempted: 15 });
    const withId = saves(fake).filter((c) => "p_op" in c.args);
    expect(withId).toHaveLength(1);                                // asked once; after the refusal no more ids
    expect(snapshot()).toMatchObject({ dirty: false });
    expect(snapshot().inflight).toBeUndefined();
  });

  it("other errors are not taken for a missing function: they are retried with the same id", async () => {
    const fake = createFakeSupabase();
    const phone = open(fake);
    await phone.loadProgress(); await phone.saveProgress(state(100));
    const original = fake.rpc.bind(fake);
    let failing = true;
    fake.rpc = async (name, args) => (name === "save_progress_v2" && failing ? (fake.calls.push({ rpc: name, args: structuredClone(args) }), { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) : original(name, args));
    await phone.saveProgress(state(150));
    failing = false;
    await phone.saveProgress(state(150));
    const [, a, b] = saves(fake);
    expect(a.args.p_op).toBeTruthy();
    expect(b.args.p_op).toBe(a.args.p_op);
    expect(core(fake).score).toBe(150);
  });
});

describe("a client that sends no id (an older version of the app)", () => {
  it("its saves are applied as before", async () => {
    const fake = createFakeSupabase();
    const r = await fake.rpc("save_progress_v2", { p_sections: { core: { score: 40 } }, p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null });
    expect(r.error).toBeNull();
    expect(core(fake).score).toBe(40);
    expect(fake.tables.progress_ops).toEqual([]);
  });
});
