// The changes of migrations 0039-0042 and the save path, through a REAL stack: GoTrue signs the players in
// (users made by register_player, as the app does), PostgREST turns the JWT into a role and answers with its own
// error and status codes, PostgreSQL 15 has Supabase's own roles and auth schema, and the client is supabase-js.
// This is what tests/integration (plain PostgreSQL + a harness that sets the role itself) cannot show.
//
//   REALSTACK_URL=http://127.0.0.1:54330 REALSTACK_PGURL=postgres://supabase_admin:...@127.0.0.1:54331/postgres \
//   REALSTACK_JWT_SECRET=... npx vitest run tests/realstack --no-file-parallelism
//
// Not covered by this stack: Realtime, Storage, Studio, the Vercel functions, the app's screens. The last test
// rolls migrations 0037-0042 back and forward on that database (it changes the schema while it runs).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("../integration/devices.js")).idbMock);

import { createSupabaseRepo } from "../../src/lib/repo";
import { lacksOpSupport } from "../../src/lib/repo/saveOps";
import { resetDevices, useDevice } from "../integration/devices";
import { ENABLED, PGURL, befriend, cleanup, newTag, promote, rows, signUp, sql, visitor } from "./stack";
import { execFileSync } from "node:child_process";

const state = (score) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [] });
const args = (score, op) => ({ p_sections: { core: { score, attempted: score / 10 } }, p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: { week_start: "2026-03-02" }, ...(op ? { p_op: op } : {}) });
const core = (id) => rows(`select data, rev from public.progress where user_id = '${id}' and section = 'core'`)[0];
const profile = (id) => rows(`select score, week_score from public.profiles where id = '${id}'`)[0];

describe.skipIf(!ENABLED)("the real stack: sign-in, PostgREST, supabase-js", () => {
  const tag = newTag();
  let ann, bob, cat, admin;
  beforeAll(async () => {
    resetDevices();
    [ann, bob, cat, admin] = await Promise.all(["ann", "bob", "cat", "adm"].map((n) => signUp(`${tag}${n}`)));
    promote(admin);
  });
  afterAll(() => cleanup(tag));

  describe("who is who", () => {
    it("a player signed in through GoTrue is `authenticated`, a visitor with the publishable key is `anon`", async () => {
      expect((await ann.client.rpc("save_progress_v2", args(10))).error).toBeNull();
      const visitorCall = await visitor().rpc("save_progress_v2", args(10));
      expect(visitorCall.error).toMatchObject({ code: "42501" });
      expect(visitorCall.status).toBe(401);
    });
    it("the admin made by a fixture is an admin, a player is not", async () => {
      expect((await admin.client.rpc("content_save_v2", { p_draft: null, p_upserts: [], p_removes: [], p_level_order: null, p_note: null, p_renames: [], p_expected_version: null, p_publish: true })).error).toBeNull();
      expect((await ann.client.rpc("content_save_v2", { p_draft: null, p_upserts: [], p_removes: [], p_level_order: null, p_note: null, p_renames: [], p_expected_version: null, p_publish: true })).error).toMatchObject({ code: "42501" });
    });
  });

  describe("migration 0042: a progress save with an operation id is applied once", () => {
    it("the same operation sent twice through PostgREST is applied once, the second answer says so", async () => {
      const op = crypto.randomUUID();
      const first = await ann.client.rpc("save_progress_v2", args(40, op));
      const again = await ann.client.rpc("save_progress_v2", args(40, op));
      expect(first.error).toBeNull();
      expect(again.data).toEqual({ duplicate: true, revs: first.data.revs });
      expect(profile(ann.id)).toMatchObject({ score: 40, week_score: 40 });
    });
    it("a call with the six old arguments (an old client) is routed to the one function, no ambiguity", async () => {
      const { p_op: _none, ...old } = args(50);
      const r = await ann.client.rpc("save_progress_v2", old);
      expect(r.error).toBeNull();
      expect(core(ann.id).data.score).toBe(50);
    });
    it("an unknown argument is PGRST202 with status 404: that is what a database without 0042 answers to p_op", async () => {
      const r = await ann.client.rpc("save_progress_v2", { ...args(50), p_nope: 1 });
      expect(r.error).toMatchObject({ code: "PGRST202" });
      expect(r.status).toBe(404);
      expect(lacksOpSupport(r.error)).toBe(true);
    });
    it("the table of operations is closed to a player", async () => {
      const r = await ann.client.from("progress_ops").select("op_id");
      expect(r.data ?? []).toEqual([]);
      expect(r.error).not.toBeNull();
    });

    it("the lost-answer scenario with the game's own repo and supabase-js: counted once", async () => {
      const lossy = { drop: false, from: (t) => bob.client.from(t), rpc: async (name, a) => { const out = await bob.client.rpc(name, a); if (name === "save_progress_v2" && lossy.drop) throw new Error("connection lost after the database saved"); return out; } };
      useDevice("bob-phone"); const phone = createSupabaseRepo({ userId: bob.id, isAdmin: false, client: lossy });
      useDevice("bob-tablet"); const tablet = createSupabaseRepo({ userId: bob.id, isAdmin: false, client: { from: (t) => bob.client.from(t), rpc: (n, a) => bob.client.rpc(n, a) } });
      useDevice("bob-phone"); await phone.loadProgress(); await phone.saveProgress(state(100));
      useDevice("bob-tablet"); await tablet.loadProgress();
      lossy.drop = true;
      useDevice("bob-phone"); await phone.saveProgress(state(150));
      expect(core(bob.id).data.score).toBe(150);
      useDevice("bob-tablet"); await tablet.saveProgress(state(130));
      expect(core(bob.id).data.score).toBe(180);
      lossy.drop = false;
      useDevice("bob-phone"); await phone.saveProgress(state(150));
      expect(core(bob.id).data).toMatchObject({ score: 180, attempted: 18 });
      expect(profile(bob.id)).toMatchObject({ score: 180, week_score: 180 });
      phone.dispose(); tablet.dispose();
    });
  });

  describe("migration 0041: the rename step is not an API", () => {
    it("an admin calling apply_item_renames directly gets 42501 from PostgREST; a player and a visitor too", async () => {
      const call = { p_renames: [{ kind: "word", from: "NoSuchA", to: "NoSuchB" }] };
      for (const who of [admin.client, ann.client, visitor()]) {
        const r = await who.rpc("apply_item_renames", call);
        expect(r.error).toMatchObject({ code: "42501" });
      }
    });
  });

  describe("migration 0039: a rename into a name another word has is refused", () => {
    const N = (s) => `${tag}${s}`;
    it("content_save_v2 answers 23505 (PostgREST status 409) and changes nothing; a free name works", async () => {
      const word = (key) => ({ kind: "words", key, data: { word: key, type: "vocab", category: N("Cat"), meaning: `m ${key}` } });
      const save = (upserts, removes, renames) => admin.client.rpc("content_save_v2", { p_draft: null, p_upserts: upserts, p_removes: removes, p_level_order: null, p_note: null, p_renames: renames, p_expected_version: null, p_publish: true });
      expect((await save([word(N("Alpha")), word(N("Beta"))], [], [])).error).toBeNull();
      await ann.client.rpc("save_progress_v2", { ...args(60), p_mastery: { [N("Alpha")]: { total: 4, correct: 4 } } });
      const refused = await save([], [{ kind: "words", key: N("Alpha") }], [{ kind: "word", from: N("Alpha"), to: N("Beta") }]);
      expect(refused.error).toMatchObject({ code: "23505" });
      expect(refused.status).toBe(409);
      expect(rows(`select item_key from public.mastery where user_id = '${ann.id}' and item_key = '${N("Alpha")}'`)).toHaveLength(1);
      expect(rows(`select key from public.content_items where key in ('${N("Alpha")}', '${N("Beta")}') order by key`)).toHaveLength(2);
      const ok = await save([word(N("Gamma"))], [{ kind: "words", key: N("Alpha") }], [{ kind: "word", from: N("Alpha"), to: N("Gamma") }]);
      expect(ok.error).toBeNull();
      expect(rows(`select item_key from public.mastery where user_id = '${ann.id}' and item_key = '${N("Gamma")}'`)).toHaveLength(1);
    });
  });

  describe("migration 0040: an offer ends with the friendship, also when the friendship comes back before the inbox is opened", () => {
    it("remove, restore, never opened: the old offer cannot be accepted (P0002, PostgREST status 400/404...), a new one can", async () => {
      await befriend(bob, cat);
      const view = await bob.client.rpc("view_create", { p_name: `${tag}Trip` });
      expect(view.error).toBeNull();
      expect((await bob.client.rpc("view_share", { p_view: view.data, p_users: [cat.id] })).error).toBeNull();
      const old = sql(`select id from public.collection_shares where from_user = '${bob.id}' and to_user = '${cat.id}' and status = 'pending'`);
      expect((await bob.client.rpc("friend_remove", { p_user: cat.id })).error).toBeNull();
      await befriend(bob, cat);
      const accept = await cat.client.rpc("view_share_accept", { p_share: old });
      expect(accept.error).toMatchObject({ code: "P0002" });
      expect((await cat.client.rpc("view_shares_inbox")).data).toEqual([]);
      expect((await bob.client.rpc("view_share", { p_view: view.data, p_users: [cat.id] })).error).toBeNull();
      expect((await cat.client.rpc("view_shares_inbox")).data).toHaveLength(1);
    });
  });

  describe("a client that knows operation ids, against a database that does not (migrations rolled back)", () => {
    const owner = (file) => execFileSync("psql", [PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1"], { input: `set role postgres;\n${readFileSync(file, "utf8")}\nnotify pgrst, 'reload schema';\n`, encoding: "utf8" });
    const until = async (fn) => { for (let i = 0; i < 40; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 250)); } throw new Error("PostgREST did not pick up the schema change"); };
    const probe = (user) => user.client.rpc("save_progress_v2", { ...args(1), p_op: crypto.randomUUID() });

    it("the save still goes through (without an id), and after the migrations come back the same client uses ids again", async () => {
      const dan = await signUp(`${tag}dan`);
      owner("supabase/rollback/0037_0042_down.sql");
      try {
        await until(async () => (await probe(dan)).error?.code === "PGRST202");
        useDevice("dan-phone");
        const repo = createSupabaseRepo({ userId: dan.id, isAdmin: false, client: { from: (t) => dan.client.from(t), rpc: (n, a) => dan.client.rpc(n, a) } });
        await repo.loadProgress();
        await repo.saveProgress(state(100));
        await repo.saveProgress(state(150));
        expect(core(dan.id).data).toMatchObject({ score: 150, attempted: 15 });
        repo.dispose();
      } finally {
        for (const n of ["0037", "0038", "0039", "0040", "0041", "0042"]) {
          const file = execFileSync("sh", ["-c", `ls supabase/migrations/${n}_*.sql`], { encoding: "utf8" }).trim();
          owner(file);
        }
      }
      await until(async () => (await probe(dan)).error === null);
      const op = crypto.randomUUID();
      expect((await dan.client.rpc("save_progress_v2", args(160, op))).error).toBeNull();
      expect((await dan.client.rpc("save_progress_v2", args(160, op))).data.duplicate).toBe(true);
    });
  });
});
