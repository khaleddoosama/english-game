// Scenarios 2 and 3: the admin renames and edits words; players keep their
// progress, and their library and views stay consistent with the content.
// App layer: createSupabaseRepo (content save with renames, progress save and
// load), the library API and id loader. Database: content_save_v2,
// apply_item_renames, save_progress_v2, dictionary_sync, RLS on all of them.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("./devices.js")).idbMock);

import { createSupabaseRepo } from "../../src/lib/repo";
import { loadIds } from "../../src/features/library/libraryIds.js";
import { createOnlineLibraryApi } from "../../src/features/library/onlineLibraryApi.js";
import { PGURL, cleanup, newTag, promote, signUp, superuser } from "./harness";
import { resetDevices, useDevice } from "./devices";
import { word } from "../libraryFixtures";

describe.skipIf(!PGURL)("renaming and editing words", () => {
  const tag = newTag();
  const N = (s) => `${tag}${s}`;
  let admin, ann, adminRepo, annRepo, content;

  // The admin's copy of the content, with the test's words in it.
  const publish = async (edit, opts) => {
    const next = structuredClone(content);
    edit(next);
    await adminRepo.saveContent(next, opts);
    content = next;
    const sync = await admin.client.rpc("dictionary_sync");
    expect(sync.error).toBeNull();
  };

  beforeAll(async () => {
    resetDevices();
    admin = promote(await signUp(`${tag}adm`));
    ann = await signUp(`${tag}ann`);
    useDevice("admin-laptop");
    adminRepo = createSupabaseRepo({ userId: admin.id, isAdmin: true, client: admin.client });
    content = (await adminRepo.loadContent()) || { words: [], grammar: [], challenges: [], stories: [], combos: [], levelOrder: [], note: "" };
    const lesson = N("Lesson");
    await publish((c) => {
      c.words.push(word(N("Alpha"), { category: lesson, opposite: N("Bravo") }), word(N("Bravo"), { category: lesson, opposite: N("Alpha") }), word(N("Charlie"), { category: lesson }));
    });
  });
  afterAll(() => cleanup(tag));

  const senseOf = async (client, key) => (await loadIds(client)).ids.senseOf(key);
  const senseOfRow = async (key) => (await admin.client.from("senses").select("meaning").eq("legacy_key", key).single()).data;
  const mastery = (key) => superuser.rows(`select stats from public.mastery where user_id = '${ann.id}' and item_key = '${key}'`)[0]?.stats;

  describe("a renamed word keeps its progress and its place in the player's views", () => {
    const stats = { total: 7, correct: 6, introducedAt: 1000, modes: { reverse: { correct: 4, total: 4 } } };
    let alphaBefore, view;
    beforeAll(async () => {
      const library = createOnlineLibraryApi(ann.client);
      alphaBefore = await senseOf(ann.client, N("Alpha"));
      await library.libraryAdd([alphaBefore, await senseOf(ann.client, N("Charlie"))]);
      view = await library.create("Fruit");
      await library.add(view, [alphaBefore]);
      // Ann plays on her phone and saves.
      useDevice("ann-phone");
      annRepo = createSupabaseRepo({ userId: ann.id, isAdmin: false, client: ann.client });
      await annRepo.loadProgress();
      await annRepo.saveProgress({ score: 120, attempted: 12, mastery: { [N("Alpha")]: stats, [N("Charlie")]: { total: 1, correct: 1, introducedAt: 5 } }, pools: { [N("Alpha")]: { gap: [{ id: "seed", attempts: 2 }] } }, confusions: { [`${N("Alpha")}|${N("Charlie")}`]: 3 }, sessionLogs: [] });
      useDevice("admin-laptop");
      await publish((c) => { c.words.find((w) => w.word === N("Alpha")).word = N("Alpha2"); c.words.find((w) => w.word === N("Bravo")).opposite = N("Alpha2"); }, { renames: [{ kind: "word", from: N("Alpha"), to: N("Alpha2") }] });
    });

    it("her mastery record, practice pool and mix-ups move to the new name", () => {
      expect(mastery(N("Alpha"))).toBeUndefined();
      expect(mastery(N("Alpha2"))).toMatchObject({ total: 7, correct: 6, introducedAt: 1000 });
      expect(mastery(N("Charlie"))).toMatchObject({ total: 1 });                       // other words are untouched
      const pools = superuser.rows(`select data from public.progress where user_id = '${ann.id}' and section = 'pools'`)[0].data.pools;
      expect(Object.keys(pools)).toEqual([N("Alpha2")]);
      const confusions = superuser.rows(`select data from public.progress where user_id = '${ann.id}' and section = 'confusions'`)[0].data.confusions;
      expect(Object.keys(confusions)).toEqual([`${N("Alpha2")}|${N("Charlie")}`]);
    });

    it("a new session loads that progress under the new name", async () => {
      useDevice("ann-tablet");
      const tablet = createSupabaseRepo({ userId: ann.id, isAdmin: false, client: ann.client });
      const data = await tablet.loadProgress();
      expect(data.mastery[N("Alpha2")]).toMatchObject({ total: 7, correct: 6 });
      expect(data.mastery[N("Alpha")]).toBeUndefined();
      tablet.dispose();
    });

    it("a phone that was offline and still uses the old name saves under the new one", async () => {
      useDevice("ann-phone");
      const offline = createSupabaseRepo({ userId: ann.id, isAdmin: false, client: ann.client });
      await offline.saveProgress({ score: 130, attempted: 13, mastery: { [N("Alpha")]: { ...stats, total: 8, correct: 7 } }, sessionLogs: [] });
      offline.dispose();
      expect(mastery(N("Alpha"))).toBeUndefined();
      expect(mastery(N("Alpha2"))).toMatchObject({ total: 8, correct: 7 });
    });

    it("the rename is remembered, for the admin only", async () => {
      expect(superuser.rows(`select to_key from public.item_key_aliases where kind = 'word' and from_key = '${N("Alpha")}'`)).toEqual([{ to_key: N("Alpha2") }]);
      expect((await ann.client.from("item_key_aliases").select("from_key")).data).toEqual([]);
      expect((await admin.client.from("item_key_aliases").select("from_key").eq("from_key", N("Alpha"))).data).toHaveLength(1);
    });

    it("her library and the view she put it in still hold the word, under its new name", async () => {
      const library = createOnlineLibraryApi(ann.client);
      const { ids } = await loadIds(ann.client);
      const nowId = ids.senseOf(N("Alpha2"));
      expect(nowId, "the renamed word has a sense").toBeTruthy();
      const inView = (await library.contents(view)).filter((r) => r.kind === "sense").map((r) => ids.keyOfSense(r.id));
      expect(inView).toEqual([N("Alpha2")]);
      const inLibrary = (await library.libraryList()).words.map((w) => ids.keyOfSense(w.id));
      expect(inLibrary).toContain(N("Alpha2"));
      expect(inLibrary).not.toContain(N("Alpha"));
    });
  });

  describe("editing a word", () => {
    let charlie, library;
    beforeAll(async () => {
      library = createOnlineLibraryApi(ann.client);
      charlie = await senseOf(ann.client, N("Charlie"));
      await library.patch(charlie, { meaning: "Ann's own wording" }, "my note");
    });

    it("changes the shared card in place: same id, new meaning, and the player's own wording is kept", async () => {
      await publish((c) => { c.words.find((w) => w.word === N("Charlie")).meaning = "A reworded definition"; });
      expect(await senseOf(ann.client, N("Charlie"))).toBe(charlie);
      const row = (await ann.client.from("senses").select("meaning, rev").eq("id", charlie).single()).data;
      expect(row.meaning).toBe("A reworded definition");
      const mine = (await library.libraryList()).words.find((w) => w.id === charlie);
      expect(mine).toMatchObject({ patch: { meaning: "Ann's own wording" }, note: "my note" });
    });

    it("is published once: the player sees the new content version, not half of it", async () => {
      const before = (await ann.client.from("content_meta").select("version").eq("id", 1).single()).data.version;
      await publish((c) => { c.words.find((w) => w.word === N("Charlie")).situation = "A new situation."; c.note = "edit"; });
      const after = (await ann.client.from("content_meta").select("version, note").eq("id", 1).single()).data;
      expect(Number(after.version)).toBe(Number(before) + 1);
      expect(after.note).toBe("edit");
      useDevice("ann-fresh");
      const seen = await createSupabaseRepo({ userId: ann.id, isAdmin: false, client: ann.client }).loadContent();
      expect(seen.words.find((w) => w.word === N("Charlie")).situation).toBe("A new situation.");
    });

    it("another tab or admin that started from an older version is refused instead of overwriting", async () => {
      useDevice("admin-second-tab");
      const second = createSupabaseRepo({ userId: admin.id, isAdmin: true, client: admin.client });
      const stale = await second.loadContent();
      await publish((c) => { c.words.find((w) => w.word === N("Charlie")).meaning = "Edited in the first tab"; });
      useDevice("admin-second-tab");
      stale.words.find((w) => w.word === N("Charlie")).meaning = "Edited in the second tab";
      await expect(second.saveContent(stale)).rejects.toMatchObject({ conflict: true });
      expect((await senseOfRow(N("Charlie"))).meaning).toBe("Edited in the first tab");
      useDevice("admin-laptop");
    });

    it("a word taken out of the content leaves the player's library, and its progress is kept for if it comes back", async () => {
      const backup = content.words.find((w) => w.word === N("Charlie"));
      await ann.client.rpc("save_progress_v2", { p_sections: {}, p_expected: null, p_mastery: { [N("Charlie")]: { total: 3, correct: 3 } }, p_mastery_removes: [], p_profile: null });
      await publish((c) => { c.words = c.words.filter((w) => w.word !== N("Charlie")); });
      expect((await library.libraryList()).words.map((w) => w.id)).not.toContain(charlie);
      expect(mastery(N("Charlie"))).toMatchObject({ total: 3 });
      await publish((c) => { c.words.push(backup); });
      expect((await library.libraryList()).words.map((w) => w.id)).toContain(charlie);          // same id: the library entry is still there
    });
  });

  describe("renaming into a name another word already has", () => {
    let delta, echo, view;
    beforeAll(async () => {
      await publish((c) => { c.words.push(word(N("Delta"), { category: N("Lesson") }), word(N("Echo"), { category: N("Lesson") })); });
      const library = createOnlineLibraryApi(ann.client);
      delta = await senseOf(ann.client, N("Delta"));
      echo = await senseOf(ann.client, N("Echo"));
      await library.libraryAdd([delta, echo]);
      view = await library.create("Greek");
      await library.add(view, [delta, echo]);
      await ann.client.rpc("save_progress_v2", { p_sections: {}, p_expected: null, p_mastery: { [N("Delta")]: { total: 5, correct: 4 }, [N("Echo")]: { total: 2, correct: 1 } }, p_mastery_removes: [], p_profile: null });
    });

    it("is refused with a clear message, and neither word, nor any progress, nor any view changes", async () => {
      const contentBefore = superuser.rows(`select kind, key, data, deleted from public.content_items where key like '${tag}%' order by key`);
      const versionBefore = superuser.rows("select version from public.content_meta where id = 1")[0].version;
      const wordsBefore = superuser.rows(`select legacy_key, deleted_at is null as live from public.senses where legacy_key like '${tag}%' order by legacy_key`);
      useDevice("admin-laptop");
      const next = structuredClone(content);
      next.words = next.words.filter((w) => w.word !== N("Delta"));
      next.words.find((w) => w.word === N("Echo")).meaning = "merged by hand";
      await expect(adminRepo.saveContent(next, { renames: [{ kind: "word", from: N("Delta"), to: N("Echo") }] })).rejects.toMatchObject({ code: "23505", message: expect.stringContaining(`There is already a word called "${N("Echo")}"`) });
      expect(superuser.rows(`select kind, key, data, deleted from public.content_items where key like '${tag}%' order by key`)).toEqual(contentBefore);
      expect(superuser.rows("select version from public.content_meta where id = 1")[0].version).toBe(versionBefore);
      expect(superuser.rows(`select legacy_key, deleted_at is null as live from public.senses where legacy_key like '${tag}%' order by legacy_key`)).toEqual(wordsBefore);
      expect(mastery(N("Delta"))).toMatchObject({ total: 5 });
      expect(mastery(N("Echo"))).toMatchObject({ total: 2 });
      const library = createOnlineLibraryApi(ann.client);
      expect((await library.contents(view)).map((r) => r.id).sort()).toEqual([delta, echo].sort());
      expect((await library.libraryList()).words.map((w) => w.id)).toEqual(expect.arrayContaining([delta, echo]));
      expect(superuser.rows(`select 1 from public.item_key_aliases where from_key = '${N("Delta")}'`)).toEqual([]);
    });

    it("the admin can still rename to a free name afterwards (nothing was left half done)", async () => {
      await publish((c) => { c.words.find((w) => w.word === N("Delta")).word = N("Delta2"); }, { renames: [{ kind: "word", from: N("Delta"), to: N("Delta2") }] });
      expect(mastery(N("Delta2"))).toMatchObject({ total: 5 });
      expect(await senseOf(ann.client, N("Delta2"))).toBe(delta);
    });
  });
});
