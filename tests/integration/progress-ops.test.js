// One logical progress save is applied once, however many times it is sent.
// The scenario that broke before: device A's save reaches the database, the
// answer is lost, device B saves, A sends the same save again. The sections are
// overwritten as a whole and the client merges counters by adding what changed,
// so a second delivery was counted twice. Every call goes to PostgreSQL as the
// signed-in player (see harness.js).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("./devices.js")).idbMock);

import { createSupabaseRepo } from "../../src/lib/repo";
import { PGURL, anon, cleanup, newTag, signUp, superuser } from "./harness";
import { resetDevices, useDevice } from "./devices";

describe.skipIf(!PGURL)("saving the same progress twice", () => {
  const tag = newTag();
  const rows = (sql) => superuser.rows(sql);
  const core = (id) => rows(`select data, rev from public.progress where user_id = '${id}' and section = 'core'`)[0];
  const profile = (id) => rows(`select score, week_score from public.profiles where id = '${id}'`)[0];
  const state = (score) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [] });
  // A client whose answers can be lost after the database has already saved.
  const lossyClient = (user) => {
    const lossy = { ...user.client, drop: false, rpc: async (name, args) => { const out = await user.client.rpc(name, args); if (name === "save_progress_v2" && lossy.drop) throw new Error("connection lost after the database saved"); return out; } };
    return lossy;
  };
  const repoOn = (device, user, client = user.client) => { useDevice(device); return createSupabaseRepo({ userId: user.id, isAdmin: false, client }); };
  beforeAll(() => { resetDevices(); });
  afterAll(() => cleanup(tag));

  describe("through the app (two devices, a lost answer)", () => {
    // The phone saves 100 -> 150 and the answer is lost; the tablet, which knew only 100, plays on to 130.
    async function lostThenOtherDevice(user, phoneName) {
      const lossy = lossyClient(user);
      const phone = repoOn(phoneName, user, lossy), tablet = repoOn(`${phoneName}-tablet`, user);
      useDevice(phoneName); await phone.loadProgress(); await phone.saveProgress(state(100));
      useDevice(`${phoneName}-tablet`); await tablet.loadProgress();
      lossy.drop = true;
      useDevice(phoneName); await phone.saveProgress(state(150));
      expect(core(user.id).data.score).toBe(150);                                    // the database has it; the phone does not know
      useDevice(`${phoneName}-tablet`); await tablet.saveProgress(state(130));        // the tablet merges: 100 + 50 + 30
      expect(core(user.id).data.score).toBe(180);
      lossy.drop = false;
      return { phone, tablet, lossy };
    }

    it("the phone sends the same save again after the tablet saved: it is counted once", async () => {
      const ann = await signUp(`${tag}ann`);
      const { phone, tablet } = await lostThenOtherDevice(ann, "ann-phone");
      useDevice("ann-phone");
      await phone.saveProgress(state(150));                                           // the retry (same play, same state)
      expect(core(ann.id).data).toMatchObject({ score: 180, attempted: 18 });
      expect(profile(ann.id)).toMatchObject({ score: 180, week_score: 180 });
      phone.dispose(); tablet.dispose();
    });

    it("the phone's page was closed in between and opened again: still counted once", async () => {
      const bob = await signUp(`${tag}bob`);
      const { phone, tablet } = await lostThenOtherDevice(bob, "bob-phone");
      phone.dispose();
      const reopened = repoOn("bob-phone", bob);
      const loaded = await reopened.loadProgress();
      expect(loaded).toMatchObject({ score: 180, attempted: 18 });
      await reopened.saveProgress(loaded);
      expect(core(bob.id).data).toMatchObject({ score: 180, attempted: 18 });
      expect(profile(bob.id)).toMatchObject({ score: 180, week_score: 180 });
      reopened.dispose(); tablet.dispose();
    });

    it("new saves after the retry are new operations: they are never taken for duplicates", async () => {
      const cat = await signUp(`${tag}cat`);
      const { phone, tablet } = await lostThenOtherDevice(cat, "cat-phone");
      useDevice("cat-phone");
      await phone.saveProgress(state(150));
      const merged = await phone.loadProgress();
      await phone.saveProgress({ ...merged, score: 200, attempted: 20 });             // the player goes on
      await phone.saveProgress({ ...merged, score: 230, attempted: 23 });
      expect(core(cat.id).data).toMatchObject({ score: 230, attempted: 23 });
      expect(profile(cat.id).score).toBe(230);
      phone.dispose(); tablet.dispose();
    });
  });

  describe("at the database", () => {
    const call = (user, score, op, expected = null) => user.client.rpc("save_progress_v2", { p_sections: { core: { score, attempted: score / 10 } }, p_expected: expected, p_mastery: {}, p_mastery_removes: [], p_profile: null, ...(op ? { p_op: op } : {}) });
    const uuid = () => crypto.randomUUID();
    let dan, eve;
    beforeAll(async () => { dan = await signUp(`${tag}dan`); eve = await signUp(`${tag}eve`); });

    it("an operation sent twice is applied once, and the second answer says so and carries the same revisions", async () => {
      const op = uuid();
      const first = await call(dan, 40, op);
      expect(first.error).toBeNull();
      expect(first.data.duplicate).toBeUndefined();
      const again = await call(dan, 40, op);
      expect(again.error).toBeNull();
      expect(again.data).toEqual({ duplicate: true, revs: first.data.revs });
      expect(core(dan.id).rev).toBe(first.data.revs.core);                            // the revision did not move
      expect(profile(dan.id)).toMatchObject({ score: 40, week_score: 40 });           // the week's points were given once
    });

    it("a second delivery does not undo what happened since", async () => {
      const op = uuid();
      await call(dan, 60, op);
      await call(dan, 90, uuid());                                                     // another save, other content
      const again = await call(dan, 60, op);
      expect(again.data.duplicate).toBe(true);
      expect(core(dan.id).data.score).toBe(90);                                       // the old content did not come back
      expect(profile(dan.id)).toMatchObject({ score: 90, week_score: 90 });
    });

    it("new operations are applied, including ones with the same content as an earlier one", async () => {
      await call(dan, 100, uuid());
      const r = await call(dan, 100, uuid());
      expect(r.data.duplicate).toBeUndefined();
      expect(r.data.revs.core).toBe(core(dan.id).rev);
    });

    it("an id used again for different content is refused and changes nothing", async () => {
      const op = uuid();
      await call(dan, 110, op);
      const before = core(dan.id);
      const bad = await call(dan, 999, op);
      expect(bad.error).toMatchObject({ code: "22023" });
      expect(core(dan.id)).toEqual(before);
    });

    it("the same id from two players are two different operations", async () => {
      const op = uuid();
      expect((await call(dan, 120, op)).data.duplicate).toBeUndefined();
      expect((await call(eve, 70, op)).data.duplicate).toBeUndefined();
      expect(core(eve.id).data.score).toBe(70);
    });

    it("two deliveries at the same moment: one applies, the other is the duplicate", async () => {
      const op = uuid();
      const [a, b] = await Promise.all([call(eve, 80, op), call(eve, 80, op)]);
      expect([a.error, b.error]).toEqual([null, null]);
      expect([a.data, b.data].filter((d) => d.duplicate)).toHaveLength(1);
      expect(profile(eve.id)).toMatchObject({ score: 80, week_score: 80 });
    });

    it("a refused write (stale revision) records nothing: the same id can be sent again", async () => {
      const op = uuid();
      const stale = await call(eve, 85, op, { core: Number(core(eve.id).rev) - 1 });
      expect(stale.data.conflict).toEqual(["core"]);
      const fresh = await call(eve, 85, op, { core: Number(core(eve.id).rev) });
      expect(fresh.data.duplicate).toBeUndefined();
      expect(core(eve.id).data.score).toBe(85);
    });

    it("a failed call records nothing", async () => {
      const op = uuid();
      const bad = await dan.client.rpc("save_progress_v2", { p_sections: [1], p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null, p_op: op });
      expect(bad.error).toMatchObject({ code: "22023" });
      expect(rows(`select 1 from public.progress_ops where user_id = '${dan.id}' and op_id = '${op}'`)).toEqual([]);
    });

    it("an old client (no operation id) still saves, as before", async () => {
      const r = await call(dan, 130, null);
      expect(r.error).toBeNull();
      expect(core(dan.id).data.score).toBe(130);
      expect(rows(`select 1 from public.progress_ops where user_id = '${dan.id}' and op_id is null`)).toEqual([]);
    });

    it("the table of operations is not open to players or visitors", async () => {
      const op = uuid();
      await call(dan, 140, op);
      expect((await dan.client.from("progress_ops").select("op_id")).error).toMatchObject({ code: "42501" });
      expect((await dan.client.from("progress_ops").insert({ user_id: dan.id, op_id: uuid(), revs: {}, digest: "x" })).error).toMatchObject({ code: "42501" });
      expect((await dan.client.from("progress_ops").delete().eq("op_id", op)).error).toMatchObject({ code: "42501" });
      expect((await anon().from("progress_ops").select("op_id")).error).toMatchObject({ code: "42501" });
      expect((await anon().rpc("save_progress_v2", { p_sections: {}, p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null, p_op: op })).error).toMatchObject({ code: "42501" });
    });

    it("old operations are forgotten after 90 days, and the player's operations go with the player", async () => {
      const op = uuid();
      await call(eve, 90, op);
      superuser.sql(`update public.progress_ops set created_at = now() - interval '91 days' where user_id = '${eve.id}' and op_id = '${op}'`);
      await call(eve, 91, uuid());                                                    // any later save clears the old ones
      expect(rows(`select 1 from public.progress_ops where user_id = '${eve.id}' and op_id = '${op}'`)).toEqual([]);
      superuser.sql(`delete from public.profiles where id = '${eve.id}'`);
      expect(rows(`select 1 from public.progress_ops where user_id = '${eve.id}'`)).toEqual([]);
    });
  });
});
