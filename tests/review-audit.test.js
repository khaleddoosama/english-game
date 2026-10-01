// Regression tests for the Codex review (October 2026). The review's three
// "observation" tests proved a problem by passing; these assert the fix:
// F01 a change is kept on the device before it is sent; F02 two devices
// merge instead of overwriting; F07 a player can't undo the admin's
// decision on a report; plus the merge rules themselves.
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map());
vi.mock("../src/lib/idb", () => ({ idb: {
  get: async (k) => cache.get(k),
  set: async (k, v) => { cache.set(k, structuredClone(v)); return true; },
  del: async (k) => { cache.delete(k); return true; },
} }));

import { createSupabaseRepo } from "../src/lib/repo";
import { mergeMasteryRecord, mergeSection } from "../src/lib/progressMerge";
import { createFakeSupabase } from "./fakeSupabase";

beforeEach(() => cache.clear());
const state = (score, extra = {}) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [], reports: [], ...extra });
const snapshot = () => cache.get("progress:u1");

describe("F01: progress is on the device before it is sent", () => {
  it("a save waiting on the network already has a dirty local snapshot", async () => {
    const fake = createFakeSupabase();
    const original = fake.rpc.bind(fake);
    let release;
    fake.rpc = (name, args) => (name === "save_progress_v2" ? new Promise((resolve) => { release = () => resolve(original(name, args)); }) : original(name, args));
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    const pending = repo.saveProgress(state(10));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(snapshot()).toMatchObject({ dirty: true, data: { score: 10 } });
    release(); await pending;
    expect(snapshot()).toMatchObject({ dirty: false, data: { score: 10 } });
    repo.dispose();
  });

  it("a slow older save never marks a newer change as saved", async () => {
    const fake = createFakeSupabase();
    const original = fake.rpc.bind(fake);
    const gates = [];
    fake.rpc = (name, args) => (name === "save_progress_v2" ? new Promise((resolve) => gates.push(() => resolve(original(name, args)))) : original(name, args));
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    const first = repo.saveProgress(state(10));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const second = repo.saveProgress(state(20));
    gates[0]();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    // The first save is on the server, the second isn't yet: still dirty, newest data.
    expect(snapshot()).toMatchObject({ dirty: true, data: { score: 20 } });
    gates[1](); await Promise.all([first, second]);
    expect(snapshot()).toMatchObject({ dirty: false, data: { score: 20 } });
    repo.dispose();
  });

  it("a failed save leaves the newest state dirty, and the next load returns it", async () => {
    const fake = createFakeSupabase();
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    await repo.saveProgress(state(10));
    fake.rpc = async () => ({ data: null, error: { message: "offline" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await repo.saveProgress(state(30));
    expect(snapshot()).toMatchObject({ dirty: true, data: { score: 30 } });
    repo.dispose();
    const fresh = createSupabaseRepo({ userId: "u1", isAdmin: false, client: createFakeSupabase() });
    expect((await fresh.loadProgress()).score).toBe(30);
    fresh.dispose();
    console.error.mockRestore();
  });

  it("reset waits for a save in flight, so old progress can't come back", async () => {
    const fake = createFakeSupabase();
    const original = fake.rpc.bind(fake);
    let release;
    fake.rpc = (name, args) => (name === "save_progress_v2" ? new Promise((resolve) => { release = () => resolve(original(name, args)); }) : original(name, args));
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    const pending = repo.saveProgress(state(50));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const reset = repo.resetProgress();
    release(); await pending; await reset;
    expect(fake.tables.progress).toEqual([]);
    expect(snapshot()).toBeUndefined();
    repo.dispose();
  });
});

describe("F02: two devices on one account", () => {
  async function twoDevices() {
    const fake = createFakeSupabase();
    const a = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await a.loadProgress(); await a.saveProgress(state(0));
    const b = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    const baseline = await b.loadProgress();
    return { fake, a, b, baseline };
  }

  it("both rounds and both scores survive (the review's case)", async () => {
    const { fake, a, b, baseline } = await twoDevices();
    await a.saveProgress({ ...state(10), sessionLogs: [{ id: "device-a", at: 1 }] });
    const merged = [];
    b.onMerged((d) => merged.push(d));
    await b.saveProgress({ ...baseline, score: 20, attempted: 2, sessionLogs: [{ id: "device-b", at: 2 }] });
    expect(merged).toHaveLength(1);
    const c = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    const final = await c.loadProgress();
    expect(final.score).toBe(30);
    expect(final.attempted).toBe(3);
    expect(final.sessionLogs.map((s) => s.id).sort()).toEqual(["device-a", "device-b"]);
    expect(fake.tables.profiles[0].score).toBe(30);
    [a, b, c].forEach((r) => r.dispose());
  });

  it("a device coming back to the foreground picks up the other's changes", async () => {
    const { fake, a, b } = await twoDevices();
    await a.saveProgress({ ...state(40), sessionLogs: [{ id: "a1", at: 5 }], mastery: { Fork: { total: 3, correct: 3 } } });
    const merged = [];
    b.onMerged((d) => merged.push(d));
    expect(await b.refreshProgress()).toBe(true);
    expect(merged[0].score).toBe(40);
    expect(merged[0].sessionLogs.map((s) => s.id)).toEqual(["a1"]);
    expect(merged[0].mastery.Fork).toEqual({ total: 3, correct: 3 });
    expect(await b.refreshProgress()).toBe(false); // nothing new now
    // b's next save doesn't conflict and doesn't undo a's work.
    const sent = fake.calls.filter((c) => c.rpc === "save_progress_v2").length;
    await b.saveProgress({ ...merged[0], score: 50 });
    expect(fake.calls.filter((c) => c.rpc === "save_progress_v2")).toHaveLength(sent + 1);
    const final = await createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake }).loadProgress();
    expect(final.score).toBe(50);
    expect(final.sessionLogs.map((s) => s.id)).toEqual(["a1"]);
    [a, b].forEach((r) => r.dispose());
  });

  it("the same word on both devices keeps the record with more answers", async () => {
    const { fake, a, b, baseline } = await twoDevices();
    await a.saveProgress({ ...state(0), mastery: { Fork: { total: 5, correct: 4, appliedSessions: ["s1"] } } });
    await b.saveProgress({ ...baseline, mastery: { Fork: { total: 2, correct: 1, appliedSessions: ["s2"] } } });
    expect(fake.tables.mastery.find((r) => r.item_key === "Fork").stats.total).toBe(5);
    [a, b].forEach((r) => r.dispose());
  });

  it("restoring a backup overwrites instead of merging, and doesn't count as this week's points", async () => {
    const { fake, a, b } = await twoDevices();
    await a.saveProgress(state(10));
    const weekBefore = fake.tables.profiles[0].week_score;
    await b.saveProgress({ ...state(9000), mastery: { Fork: { total: 1, correct: 1 } } }, { replace: true });
    expect(fake.tables.profiles[0].score).toBe(9000);
    expect(fake.tables.profiles[0].week_score).toBe(weekBefore);
    [a, b].forEach((r) => r.dispose());
  });

  it("this week's points are what the score went up by", async () => {
    const fake = createFakeSupabase();
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    await repo.saveProgress(state(100));
    await repo.saveProgress(state(130));
    expect(fake.tables.profiles[0].week_score).toBe(130);
    await repo.saveProgress(state(120)); // a lower score never takes points away
    expect(fake.tables.profiles[0].week_score).toBe(130);
    repo.dispose();
  });

  it("unsynced play from this device merges with the other device's on the next start", async () => {
    const { fake, a, baseline } = await twoDevices();
    // b played offline: its snapshot is dirty with a base from before.
    const b = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await b.loadProgress();
    fake.rpcBackup = fake.rpc; fake.rpc = async () => ({ data: null, error: { message: "offline" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await b.saveProgress({ ...baseline, score: 15, attempted: 1, sessionLogs: [{ id: "b-offline", at: 3 }] });
    b.dispose();
    fake.rpc = fake.rpcBackup;
    // Each device has its own storage: keep b's.
    const bStorage = structuredClone(snapshot());
    expect(bStorage.dirty).toBe(true);
    // Meanwhile a played online.
    await a.saveProgress({ ...state(25), sessionLogs: [{ id: "a-online", at: 4 }] });
    cache.set("progress:u1", bStorage);
    const again = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    const loaded = await again.loadProgress();
    expect(loaded.score).toBe(40);
    expect(loaded.sessionLogs.map((s) => s.id).sort()).toEqual(["a-online", "b-offline"]);
    console.error.mockRestore();
    [a, again].forEach((r) => r.dispose());
  });
});

describe("merge rules", () => {
  it("only one side changed a field: that side wins", () => {
    expect(mergeSection({ score: 1, settings: { a: 1 } }, { score: 1, settings: { a: 2 } }, { score: 5, settings: { a: 1 } })).toEqual({ score: 5, settings: { a: 2 } });
  });
  it("counters add up, bests take the higher, the later study day wins", () => {
    const base = { score: 100, attempted: 10, bestStreak: 4, studyStreak: 2, lastStudyDate: "2026-09-30" };
    const local = { score: 130, attempted: 13, bestStreak: 7, studyStreak: 3, lastStudyDate: "2026-10-01" };
    const server = { score: 150, attempted: 15, bestStreak: 5, studyStreak: 3, lastStudyDate: "2026-09-30" };
    expect(mergeSection(base, local, server)).toEqual({ score: 180, attempted: 18, bestStreak: 7, studyStreak: 3, lastStudyDate: "2026-10-01" });
  });
  it("today's goal adds both devices' answers", () => {
    const base = { dailyProgress: { date: "2026-10-01", answered: 4, correct: 3 } };
    const out = mergeSection(base, { dailyProgress: { date: "2026-10-01", answered: 10, correct: 8 } }, { dailyProgress: { date: "2026-10-01", answered: 7, correct: 5 } });
    expect(out.dailyProgress).toMatchObject({ answered: 13, correct: 10 });
  });
  it("level stats, mix-ups and cleared levels combine", () => {
    const base = { levelStats: { L: { attempts: 2, stars: 1, bestAccuracy: 50 } }, levelsCleared: ["a"] };
    const local = { levelStats: { L: { attempts: 3, stars: 2, bestAccuracy: 70 } }, levelsCleared: ["a", "b"] };
    const server = { levelStats: { L: { attempts: 4, stars: 1, bestAccuracy: 90 }, M: { attempts: 1 } }, levelsCleared: ["a", "c"] };
    const out = mergeSection(base, local, server);
    expect(out.levelStats.L).toMatchObject({ attempts: 5, stars: 2, bestAccuracy: 90 });
    expect(out.levelStats.M).toEqual({ attempts: 1 });
    expect(out.levelsCleared.sort()).toEqual(["a", "b", "c"]);
    expect(mergeSection({ confusions: { "a|b": 1 } }, { confusions: { "a|b": 3 } }, { confusions: { "a|b": 2 } }).confusions["a|b"]).toBe(4);
  });
  it("a word changed on both devices: more answers wins, rounds are kept from both", () => {
    const out = mergeMasteryRecord({ total: 2, appliedSessions: ["s0"] }, { total: 3, appliedSessions: ["s0", "s1"] }, { total: 4, appliedSessions: ["s0", "s2"] });
    expect(out.total).toBe(4);
    expect(out.appliedSessions.sort()).toEqual(["s0", "s1", "s2"]);
  });
});

describe("merging never drops other players' reports (admin)", () => {
  it("a conflict on the reports section keeps them and deletes nothing", async () => {
    const fake = createFakeSupabase({ userId: "u1", admin: true });
    fake.tables.profiles.push({ id: "p2", username: "sara", role: "player" });
    fake.tables.reports.push({ id: "r-sara", user_id: "p2", data: { id: "r-sara", reason: "Typo" }, resolved_at: null, created_at: "2026-01-01" });
    const a = createSupabaseRepo({ userId: "u1", isAdmin: true, client: fake });
    const first = await a.loadProgress();
    expect(first.reports.map((r) => r.id)).toEqual(["r-sara"]);
    await a.saveProgress({ ...state(0), reports: first.reports });
    const b = createSupabaseRepo({ userId: "u1", isAdmin: true, client: fake });
    const fromB = await b.loadProgress();
    await a.saveProgress({ ...state(0), reports: [...first.reports, { id: "mine-a", reason: "x" }] });
    let merged = null;
    b.onMerged((d) => { merged = d; });
    await b.saveProgress({ ...fromB, reports: [...fromB.reports, { id: "mine-b", reason: "y" }] });
    expect(merged.reports.map((r) => r.id).sort()).toEqual(["mine-a", "mine-b", "r-sara"]);
    expect(fake.tables.reports.map((r) => r.id).sort()).toEqual(["mine-a", "mine-b", "r-sara"]);
    [a, b].forEach((r) => r.dispose());
  });
});

describe("F07: the admin decides what happens to a report", () => {
  // A player and the admin on one database (the fake's report triggers
  // mirror supabase/migrations/0018_report_ownership.sql).
  const setup = () => {
    const fake = createFakeSupabase({ userId: "p1", admin: false });
    const adminDb = createFakeSupabase({ userId: "a1", admin: true, tables: fake.tables });
    return { fake, adminDb, player: createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake }) };
  };
  const report = { id: "audit-report", reason: "Typo", resolvedAt: null };
  const row = (fake) => fake.tables.reports.find((r) => r.id === "audit-report");

  it("a player's edit doesn't reopen a report the admin resolved (the review's case)", async () => {
    const { fake, adminDb, player } = setup();
    await player.loadProgress();
    await player.saveProgress({ ...state(0), reports: [report] });
    await adminDb.from("reports").update({ resolved_at: "2026-10-01T00:00:00.000Z", data: { ...report, resolvedAt: Date.parse("2026-10-01") } }).eq("id", "audit-report");
    await player.saveProgress({ ...state(0), reports: [{ ...report, reason: "More detail" }] });
    expect(row(fake)).toMatchObject({ resolved_at: "2026-10-01T00:00:00.000Z", user_id: "p1", data: { reason: "More detail", resolvedAt: Date.parse("2026-10-01") } });
    // Not even by asking the database directly.
    await fake.from("reports").upsert([{ id: "audit-report", data: { ...report, resolvedAt: null }, resolved_at: null }]);
    await fake.from("reports").update({ resolved_at: null, user_id: "someone" }).eq("id", "audit-report");
    expect(row(fake)).toMatchObject({ resolved_at: "2026-10-01T00:00:00.000Z", user_id: "p1" });
    player.dispose();
  });

  it("the player's device shows the admin's decision after a reload", async () => {
    const { fake, adminDb, player } = setup();
    await player.loadProgress();
    await player.saveProgress({ ...state(0), reports: [report, { id: "still-open", reason: "Other" }] });
    await adminDb.from("reports").update({ resolved_at: "2026-10-01T00:00:00.000Z" }).eq("id", "audit-report");
    player.dispose();
    cache.clear();
    const again = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    const loaded = await again.loadProgress();
    expect(loaded.reports.map((r) => [r.id, r.resolvedAt])).toEqual([["audit-report", Date.parse("2026-10-01")], ["still-open", null]]);
    // Showing it isn't a change: nothing is sent back.
    const before = fake.calls.length;
    await again.saveProgress({ ...loaded });
    expect(fake.calls.slice(before).filter((c) => c.table === "reports")).toEqual([]);
    again.dispose();
  });

  it("a report the admin deleted doesn't come back from the player's device", async () => {
    const { fake, adminDb, player } = setup();
    await player.loadProgress();
    await player.saveProgress({ ...state(0), reports: [report] });
    await adminDb.from("reports").delete().in("id", ["audit-report"]);
    // The device still has it and sends it again with a change.
    await player.saveProgress({ ...state(0), reports: [{ ...report, reason: "Again" }] });
    expect(row(fake)).toBeUndefined();
    player.dispose();
    // After a reload it's gone from the player's list too, while a report
    // filed offline and never sent is kept.
    cache.set("progress:p1", { dirty: true, data: { ...state(0), reports: [report, { id: "offline", reason: "New" }] }, base: { revs: {}, sections: {} } });
    const again = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    const loaded = await again.loadProgress();
    expect(loaded.reports.map((r) => r.id)).toEqual(["offline"]);
    again.dispose();
  });

  it("dropping old resolved reports on the device doesn't delete them for the admin", async () => {
    const { fake, adminDb, player } = setup();
    await player.loadProgress();
    await player.saveProgress({ ...state(0), reports: [report] });
    await adminDb.from("reports").update({ resolved_at: "2026-10-01T00:00:00.000Z" }).eq("id", "audit-report");
    player.dispose();
    const again = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    await again.loadProgress();
    await again.saveProgress({ ...state(0), reports: [{ id: "newer", reason: "x" }] });
    expect(fake.tables.reports.map((r) => r.id).sort()).toEqual(["audit-report", "newer"]);
    again.dispose();
  });

  it("someone else's report in an imported backup doesn't stop saving", async () => {
    const { fake, adminDb, player } = setup();
    await adminDb.from("reports").upsert([{ id: "admins-report", data: { id: "admins-report", reason: "Typo" } }]);
    await player.loadProgress();
    await player.saveProgress({ ...state(7), reports: [{ id: "admins-report", reason: "Changed" }, { id: "mine", reason: "x" }] }, { replace: true });
    expect(fake.tables.progress.find((r) => r.section === "core").data.score).toBe(7);
    expect(fake.tables.reports.find((r) => r.id === "admins-report")).toMatchObject({ user_id: "a1", data: { reason: "Typo" } });
    expect(fake.tables.reports.find((r) => r.id === "mine").user_id).toBe("p1");
    player.dispose();
    cache.clear();
    const again = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    expect((await again.loadProgress()).reports.map((r) => r.id)).toEqual(["mine"]);
    again.dispose();
  });

  it("the admin's notes on a player's report survive the player's next save", async () => {
    const { fake, adminDb, player } = setup();
    await player.loadProgress();
    await player.saveProgress({ ...state(0), reports: [report] });
    await adminDb.from("reports").update({ data: { ...report, aiReview: { verdict: "fixed" } } }).eq("id", "audit-report");
    player.dispose();
    const again = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    const loaded = await again.loadProgress();
    expect(loaded.reports[0].aiReview).toEqual({ verdict: "fixed" });
    await again.saveProgress({ ...loaded, score: 5 });
    expect(row(fake).data.aiReview).toEqual({ verdict: "fixed" });
    again.dispose();
  });
});

describe("F03 and F08: renames and publishing content", () => {
  const word = (w, extra = {}) => ({ word: w, category: "Food", meaning: "m", situation: "s", gap: "a ___ b", hints: ["h"], ...extra });
  async function setup() {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const admin = createSupabaseRepo({ userId: "admin", isAdmin: true, client: fake });
    await admin.loadContent();
    await admin.saveContent({ words: [word("Apple"), word("Bread")], levelOrder: ["Food"] });
    return { fake, admin };
  }

  it("a rename moves every player's record, keeping the one with more answers", async () => {
    const { fake, admin } = await setup();
    fake.tables.mastery.push(
      { user_id: "p1", item_key: "Apple", stats: { total: 4, correct: 3 } },
      { user_id: "p2", item_key: "Apple", stats: { total: 2 } }, { user_id: "p2", item_key: "Green apple", stats: { total: 5 } },
    );
    fake.tables.progress.push({ user_id: "p1", section: "pools", data: { pools: { Apple: { gap: [1] } } }, rev: 3 });
    await admin.saveContent({ words: [word("Green apple"), word("Bread")], levelOrder: ["Food"] }, { renames: [{ kind: "word", from: "Apple", to: "Green apple" }] });
    const rows = (u) => fake.tables.mastery.filter((m) => m.user_id === u).map((m) => [m.item_key, m.stats.total]);
    expect(rows("p1")).toEqual([["Green apple", 4]]);
    expect(rows("p2")).toEqual([["Green apple", 5]]);
    expect(fake.tables.progress.find((p) => p.user_id === "p1").data.pools).toEqual({ "Green apple": { gap: [1] } });
    // The rename went in the same call as the content change.
    const last = fake.calls.filter((c) => c.rpc === "content_save_v2").at(-1).args;
    expect(last.p_renames).toEqual([{ kind: "word", from: "Apple", to: "Green apple" }]);
    expect(last.p_upserts.map((u) => u.key)).toContain("Green apple");
    admin.dispose();
  });

  it("an offline device that still sends the old name saves under the new one", async () => {
    const { fake, admin } = await setup();
    await admin.saveContent({ words: [word("Green apple"), word("Bread")], levelOrder: ["Food"] }, { renames: [{ kind: "word", from: "Apple", to: "Green apple" }] });
    const player = createSupabaseRepo({ userId: "admin", isAdmin: true, client: fake });
    await player.loadProgress();
    await player.saveProgress({ score: 0, mastery: { Apple: { total: 1, correct: 1 } } });
    expect(fake.tables.mastery.map((m) => m.item_key)).toEqual(["Green apple"]);
    [admin, player].forEach((r) => r.dispose());
  });

  it("a large import is staged and published by one final call", async () => {
    const { fake, admin } = await setup();
    const many = Array.from({ length: 600 }, (_, i) => word(`W${i}`));
    const before = fake.tables.content_meta[0].version;
    await admin.saveContent({ words: many, levelOrder: ["Food"] });
    const calls = fake.calls.filter((c) => c.rpc === "content_save_v2").slice(-3).map((c) => [c.args.p_publish, c.args.p_upserts.length]);
    expect(calls).toEqual([[false, 250], [false, 250], [true, 100]]);
    expect(fake.tables.content_meta[0].version).toBe(before + 1); // one new version, not three
    expect(fake.tables.content_items.filter((r) => !r.deleted).length).toBe(600);
    admin.dispose();
  });

  it("a failure before publishing leaves the published content as it was", async () => {
    const { fake, admin } = await setup();
    const original = fake.rpc.bind(fake);
    fake.rpc = async (name, args) => (name === "content_save_v2" && args.p_publish ? { data: null, error: { message: "network down" } } : original(name, args));
    const many = Array.from({ length: 600 }, (_, i) => word(`W${i}`));
    await expect(admin.saveContent({ words: many, levelOrder: ["Food"] })).rejects.toThrow("network down");
    expect(fake.tables.content_items.filter((r) => !r.deleted).map((r) => r.key).sort()).toEqual(["Apple", "Bread"]);
    admin.dispose();
  });

  it("two tabs: the second save is refused instead of overwriting", async () => {
    const { fake, admin } = await setup();
    const other = createSupabaseRepo({ userId: "admin", isAdmin: true, client: fake });
    await other.loadContent();
    await admin.saveContent({ words: [word("Apple", { meaning: "from tab 1" }), word("Bread")], levelOrder: ["Food"] });
    await expect(other.saveContent({ words: [word("Apple", { meaning: "from tab 2" }), word("Bread")], levelOrder: ["Food"] })).rejects.toMatchObject({ conflict: true });
    expect(fake.tables.content_items.find((r) => r.key === "Apple").data.meaning).toBe("from tab 1");
    [admin, other].forEach((r) => r.dispose());
  });
});
