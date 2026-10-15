// The two stateful parts split out of the repo: the content store and the
// reports sync. Each owns its own state; these tests drive them directly, with
// the in-memory fake database (tests/fakeSupabase.js).
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map());
vi.mock("../src/lib/idb", () => ({ idb: {
  get: async (k) => cache.get(k),
  set: async (k, v) => { cache.set(k, structuredClone(v)); return true; },
  del: async (k) => { cache.delete(k); return true; },
} }));

import { createContentStore } from "../src/lib/repo/contentStore";
import { createReportsSync } from "../src/lib/repo/reportsSync";
import { createFakeSupabase } from "./fakeSupabase";

beforeEach(() => { cache.clear(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
const words = (n) => Array.from({ length: n }, (_, i) => ({ word: `W${String(i).padStart(4, "0")}`, type: "vocab", category: "C", meaning: "m" }));
const contentCalls = (fake) => fake.calls.filter((c) => c.rpc === "content_save_v2");

describe("content store", () => {
  it("a small save is one call, publishing at once", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const store = createContentStore({ sb: fake, isAdmin: true });
    await store.load();
    await store.save({ words: words(3) });
    const calls = contentCalls(fake);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_publish: true, p_draft: null });
    expect(calls[0].args.p_upserts).toHaveLength(3);
  });

  it("a big save goes into a draft in batches of 250 and is published by the last call", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const store = createContentStore({ sb: fake, isAdmin: true });
    await store.load();
    await store.save({ words: words(600) });
    const calls = contentCalls(fake).map((c) => c.args);
    expect(calls.map((a) => [a.p_upserts.length, a.p_publish])).toEqual([[250, false], [250, false], [100, true]]);
    expect(new Set(calls.map((a) => a.p_draft)).size).toBe(1);
    expect(calls[0].p_draft).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.tables.content_items.filter((r) => !r.deleted)).toHaveLength(600);
  });

  it("saves nothing when nothing changed, and nothing at all for a player", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const store = createContentStore({ sb: fake, isAdmin: true });
    await store.load(); await store.save({ words: words(2) });
    const n = contentCalls(fake).length;
    await store.save({ words: words(2) });
    expect(contentCalls(fake).length).toBe(n);
    const player = createContentStore({ sb: fake, isAdmin: false });
    await player.save({ words: words(5) });
    expect(contentCalls(fake).length).toBe(n);
  });

  it("each store keeps its own version: a second admin tab with an old version is refused", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const a = createContentStore({ sb: fake, isAdmin: true });
    await a.load(); await a.save({ words: words(1) });
    const b = createContentStore({ sb: fake, isAdmin: true });
    const seenByB = await b.load();
    await a.save({ words: words(2) });
    await expect(b.save({ ...seenByB, words: [...seenByB.words, ...words(5).slice(3)] })).rejects.toMatchObject({ conflict: true });
  });

  it("a player's load: first from the server, then from the cache without asking for items, and from the cache when offline", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    const admin = createContentStore({ sb: fake, isAdmin: true });
    await admin.load(); await admin.save({ words: words(4) });
    cache.clear();
    const player = createContentStore({ sb: fake, isAdmin: false });
    expect((await player.load()).words).toHaveLength(4);
    const reads = () => fake.calls.filter((c) => c.table === "content_items").length;
    const before = reads();
    expect((await createContentStore({ sb: fake, isAdmin: false }).load()).words).toHaveLength(4);
    expect(reads()).toBe(before);                                        // the version is the same: the cache is used
    const down = { from: () => { throw new Error("offline"); }, rpc: async () => ({ error: { message: "offline" } }) };
    expect((await createContentStore({ sb: down, isAdmin: false }).load()).words).toHaveLength(4);
  });

  it("with no cache and no connection, the load fails", async () => {
    const down = { from: () => { throw new Error("offline"); } };
    await expect(createContentStore({ sb: down, isAdmin: false }).load()).rejects.toThrow("offline");
  });
});

describe("reports sync", () => {
  const report = (id, extra = {}) => ({ id, note: "n", ...extra });

  it("nothing to send when what the table holds is what the player has", async () => {
    const fake = createFakeSupabase({ userId: "u1", admin: false });
    const sync = createReportsSync({ sb: fake, isAdmin: false });
    expect(sync.changed([], [])).toBe(false);
    expect(sync.changed([report("r1")], [])).toBe(true);
    await sync.sync([report("r1")], []);
    expect(sync.changed([report("r1")], [])).toBe(false);
    expect(fake.tables.reports.map((r) => r.id)).toEqual(["r1"]);
  });

  it("a report taken out on this device is deleted from the table, and an edited one is sent again", async () => {
    const fake = createFakeSupabase({ userId: "u1", admin: false });
    const sync = createReportsSync({ sb: fake, isAdmin: false });
    await sync.sync([report("r1"), report("r2")], []);
    expect(sync.changed([report("r1"), report("r2", { note: "edited" })], [])).toBe(true);
    await sync.sync([report("r2", { note: "edited" })], []);
    expect(fake.tables.reports.map((r) => [r.id, r.data.note])).toEqual([["r2", "edited"]]);
  });

  it("the admin's decision on a player's report is read back and not undone by the player's copy", async () => {
    const fake = createFakeSupabase({ userId: "u1", admin: false });
    const sync = createReportsSync({ sb: fake, isAdmin: false });
    await sync.sync([report("r1")], []);
    fake.tables.reports[0].resolved_at = "2026-03-01T00:00:00.000Z";
    const back = sync.reconcile([report("r1")], [report("r1")], fake.tables.reports);
    expect(back[0].resolvedAt).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
    expect(sync.changed(back, [])).toBe(false);
  });

  it("the admin also keeps track of other players' reports: sends a change, and a removal", async () => {
    const fake = createFakeSupabase({ userId: "admin", admin: true });
    fake.tables.reports.push({ id: "p1", user_id: "someone", data: { id: "p1", note: "n" }, resolved_at: null, created_at: "2026-01-01" });
    const sync = createReportsSync({ sb: fake, isAdmin: true });
    const remote = [{ id: "p1", note: "n", _remote: true, _from: "someone", _filedAt: 1 }];
    sync.rememberRemote(remote);
    expect(sync.changed([], remote)).toBe(false);
    const resolved = [{ ...remote[0], resolvedAt: Date.parse("2026-03-02T00:00:00.000Z") }];
    expect(sync.changed([], resolved)).toBe(true);
    await sync.sync([], resolved);
    expect(fake.tables.reports[0].resolved_at).toBe("2026-03-02T00:00:00.000Z");
    expect(fake.tables.reports[0].data).toEqual({ id: "p1", note: "n", resolvedAt: Date.parse("2026-03-02T00:00:00.000Z") });
    expect(sync.changed([], [])).toBe(true);                             // p1 is no longer on this admin's list: that is a deletion to send
    await sync.sync([], []);
    expect(fake.tables.reports).toEqual([]);
  });

  it("a server error other than 'not yours' stops the save", async () => {
    const sb = { from: () => ({ upsert: async () => ({ error: { code: "XX000", message: "down" } }) }) };
    const sync = createReportsSync({ sb, isAdmin: false });
    await expect(sync.sync([report("r1")], [])).rejects.toMatchObject({ message: "down" });
  });
});
