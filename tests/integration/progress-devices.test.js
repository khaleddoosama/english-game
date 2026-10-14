// Scenario 4: one player, two devices. The repo (src/lib/repo.js) saves and
// merges progress through save_progress_v2; the database keeps a revision per
// section and refuses a write based on an old one. Every call below really
// goes to PostgreSQL as the signed-in player.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("./devices.js")).idbMock);

import { createSupabaseRepo } from "../../src/lib/repo";
import { PGURL, cleanup, newTag, signUp, superuser } from "./harness";
import { resetDevices, useDevice } from "./devices";

describe.skipIf(!PGURL)("progress from two devices", () => {
  const tag = newTag();
  const W = (n) => `${tag}W${n}`;
  let ann, bob, phone, tablet, merges;
  const repoOn = (device) => { useDevice(device); return createSupabaseRepo({ userId: ann.id, isAdmin: false, client: ann.client }); };
  const on = (device, fn) => { useDevice(device); return fn(); };
  const round = (id, at) => ({ id, at, kind: "practice", total: 5, correct: 4 });
  const rows = (sql) => superuser.rows(sql);
  const section = (name) => rows(`select data, rev from public.progress where user_id = '${ann.id}' and section = '${name}'`)[0];
  const masteryRow = (key) => rows(`select stats from public.mastery where user_id = '${ann.id}' and item_key = '${key}'`)[0]?.stats;
  const profile = () => rows(`select score, mastered_count, week_score from public.profiles where id = '${ann.id}'`)[0];

  const base = () => ({ score: 100, attempted: 10, studyStreak: 2, lastStudyDate: "2026-03-01", mastery: { [W(1)]: { total: 2, correct: 2, introducedAt: 1 } }, sessionLogs: [round("r1", 1000)], completedSessions: ["s1"], levelsCleared: ["cat-A"] });

  beforeAll(async () => {
    resetDevices();
    ann = await signUp(`${tag}ann`);
    bob = await signUp(`${tag}bob`);
    phone = repoOn("phone");
    tablet = repoOn("tablet");
  });
  afterAll(() => { phone.dispose(); tablet.dispose(); cleanup(tag); });

  it("a first save on one device is what the other device loads", async () => {
    useDevice("phone");
    expect(await phone.loadProgress()).toBeNull();
    await phone.saveProgress(base());
    useDevice("tablet");
    const seen = await tablet.loadProgress();
    expect(seen).toMatchObject({ score: 100, attempted: 10, completedSessions: ["s1"] });
    expect(seen.mastery[W(1)]).toMatchObject({ total: 2 });
    expect(profile()).toMatchObject({ score: 100 });
  });

  it("both devices play from the same point: nothing either of them did is lost", async () => {
    merges = [];
    tablet.onMerged((d) => merges.push(d));
    // The phone plays 5 questions more and saves first.
    useDevice("phone");
    await phone.saveProgress({ ...base(), score: 150, attempted: 15, mastery: { [W(1)]: { total: 4, correct: 4, introducedAt: 1 }, [W(2)]: { total: 1, correct: 1, introducedAt: 2 } }, sessionLogs: [round("r2", 2000), round("r1", 1000)], completedSessions: ["s1", "s2"] });
    const revAfterPhone = section("core").rev;

    // The tablet never heard of that. It plays 3 questions and saves.
    useDevice("tablet");
    await tablet.saveProgress({ ...base(), score: 130, attempted: 13, mastery: { [W(1)]: { total: 3, correct: 3, introducedAt: 1 }, [W(3)]: { total: 1, correct: 1, introducedAt: 3 } }, sessionLogs: [round("r3", 3000), round("r1", 1000)], completedSessions: ["s1", "s3"], levelsCleared: ["cat-A", "cat-B"] });

    expect(merges, "the tablet was told another device had saved first").toHaveLength(1);
    expect(Number(section("core").rev)).toBeGreaterThan(Number(revAfterPhone));

    // A third device that was never there loads what the database now holds.
    const laptop = repoOn("laptop");
    const merged = await laptop.loadProgress();
    laptop.dispose();
    expect(merged.score).toBe(180);                              // 100 + the phone's 50 + the tablet's 30
    expect(merged.attempted).toBe(18);
    expect(merged.sessionLogs.map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect([...merged.completedSessions].sort()).toEqual(["s1", "s2", "s3"]);
    expect([...merged.levelsCleared].sort()).toEqual(["cat-A", "cat-B"]);
    expect(Object.keys(merged.mastery).sort()).toEqual([W(1), W(2), W(3)].sort());
    expect(merged.mastery[W(1)].total).toBe(4);                  // the record with more answers wins
  });

  it("the leaderboard numbers follow the merged score, and this week counts each point once", () => {
    expect(profile()).toMatchObject({ score: 180, week_score: 180 });
  });

  it("the phone picks the tablet's play up when it comes back to the foreground", async () => {
    useDevice("phone");
    const told = [];
    phone.onMerged((d) => told.push(d));
    expect(await phone.refreshProgress()).toBe(true);
    expect(told[0].score).toBe(180);
    expect(Object.keys(told[0].mastery)).toContain(W(3));
    expect(await phone.refreshProgress()).toBe(false);           // nothing new the second time
  });

  it("saving the same progress again changes nothing on the server", async () => {
    const before = section("core");
    const phoneNow = await on("phone", () => phone.loadProgress());
    await on("phone", () => phone.saveProgress(phoneNow));
    await on("phone", () => phone.saveProgress(phoneNow));
    expect(section("core")).toEqual(before);
    expect(profile().week_score).toBe(180);
  });

  describe("at the database", () => {
    it("a write based on an old revision is refused and writes nothing; the answer carries the server's copy", async () => {
      const core = section("core");
      const r = await ann.client.rpc("save_progress_v2", { p_sections: { core: { score: 999 } }, p_expected: { core: Number(core.rev) - 1 }, p_mastery: {}, p_mastery_removes: [], p_profile: null });
      expect(r.error).toBeNull();
      expect(r.data.conflict).toEqual(["core"]);
      expect(r.data.sections.core.data.score).toBe(180);
      expect(section("core")).toEqual(core);
      expect(profile().score).toBe(180);
    });

    it("a write based on the current revision goes through and moves the revision on", async () => {
      const core = section("core");
      const r = await ann.client.rpc("save_progress_v2", { p_sections: { core: { ...core.data, score: 190 } }, p_expected: { core: Number(core.rev) }, p_mastery: {}, p_mastery_removes: [], p_profile: null });
      expect(r.data.revs.core).toBe(Number(core.rev) + 1);
      expect(profile().score).toBe(190);
    });

    it("a mastery record with fewer answers never replaces one with more", async () => {
      await ann.client.rpc("save_progress_v2", { p_sections: {}, p_expected: null, p_mastery: { [W(1)]: { total: 1, correct: 1 } }, p_mastery_removes: [], p_profile: null });
      expect(masteryRow(W(1)).total).toBe(4);
    });

    it("the score can't go negative, junk is refused, and nothing is written for a call that fails", async () => {
      const bad = await ann.client.rpc("save_progress_v2", { p_sections: [1, 2], p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null });
      expect(bad.error).toMatchObject({ code: "22023" });
      const neg = await ann.client.rpc("save_progress_v2", { p_sections: { core: { score: -50 } }, p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null });
      expect(neg.error).toBeNull();
      expect(profile().score).toBe(0);
    });
  });

  it("restoring a backup replaces the server's copy instead of merging, and gives no points for this week", async () => {
    useDevice("phone");
    const week = profile().week_score;
    await phone.saveProgress({ score: 20, attempted: 2, mastery: { [W(9)]: { total: 1, correct: 1 } }, sessionLogs: [round("old", 1)] }, { replace: true });
    const after = await repoOn("laptop-2").loadProgress();
    expect(after.score).toBe(20);
    expect(Object.keys(after.mastery)).toEqual([W(9)]);
    expect(after.sessionLogs.map((r) => r.id)).toEqual(["old"]);
    expect(profile().week_score).toBe(week);
  });

  it("resetting progress on one device clears this player's data and no one else's", async () => {
    useDevice("tablet");
    await bob.client.rpc("save_progress_v2", { p_sections: { core: { score: 77 } }, p_expected: null, p_mastery: { [W(1)]: { total: 1 } }, p_mastery_removes: [], p_profile: null });
    await tablet.resetProgress();
    expect(rows(`select 1 from public.progress where user_id = '${ann.id}'`)).toEqual([]);
    expect(rows(`select 1 from public.mastery where user_id = '${ann.id}'`)).toEqual([]);
    expect(rows(`select data from public.progress where user_id = '${bob.id}' and section = 'core'`)[0].data.score).toBe(77);
    expect(await repoOn("tablet-2").loadProgress()).toBeNull();
  });
});
