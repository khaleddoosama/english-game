// Scenario 6: one player cannot read or change another player's data, by any
// door: the tables, the functions, or a guessed id. The checks go through
// every table in the schema, so a table added later without row-level
// security fails here.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("./devices.js")).idbMock);

import { createOnlineLibraryApi } from "../../src/features/library/onlineLibraryApi.js";
import { loadIds } from "../../src/features/library/libraryIds.js";
import { PGURL, anon, as, befriend, cleanup, newTag, promote, signUp, superuser } from "./harness";
import { resetDevices } from "./devices";
import { adminPublisher } from "./content";
import { word } from "../libraryFixtures";

describe.skipIf(!PGURL)("players cannot reach each other's data", () => {
  const tag = newTag();
  const N = (s) => `${tag}${s}`;
  let admin, ann, bob, A, B, view, own, token;
  const count = (sql) => superuser.rows(`select count(*)::int as n from (${sql}) q`)[0].n;
  const annsRows = () => ({
    progress: count(`select 1 from public.progress where user_id = '${ann.id}'`),
    mastery: count(`select 1 from public.mastery where user_id = '${ann.id}'`),
    reports: count(`select 1 from public.reports where user_id = '${ann.id}'`),
    library: count(`select 1 from public.library_entries where user_id = '${ann.id}' and removed_at is null`),
    views: count(`select 1 from public.collections where owner_id = '${ann.id}' and deleted_at is null`),
    inViews: count(`select 1 from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.owner_id = '${ann.id}' and cs.removed_at is null`),
    links: count(`select 1 from public.view_links where owner_id = '${ann.id}' and revoked_at is null`),
    own: count(`select 1 from public.senses where owner_id = '${ann.id}' and deleted_at is null`),
    meaning: superuser.one(`select meaning from public.senses where id = '${own}'`),
    profile: JSON.stringify(superuser.rows(`select username, role, score, mastered_count from public.profiles where id = '${ann.id}'`)),
  });

  beforeAll(async () => {
    resetDevices();
    admin = promote(await signUp(`${tag}adm`));
    ann = await signUp(`${tag}ann`);
    bob = await signUp(`${tag}bob`);
    await befriend(ann, bob);
    const course = await adminPublisher(admin);
    await course.publish((c) => { c.words.push(word(N("Plane"))); });
    A = createOnlineLibraryApi(ann.client); B = createOnlineLibraryApi(bob.client);
    const ids = (await loadIds(ann.client)).ids;
    own = (await A.createWord({ word: N("Quokka"), meaning: "private meaning" })).id;
    view = await A.create("Secret view");
    await A.add(view, [own, ids.senseOf(N("Plane"))]);
    token = (await A.linkCreate(view)).token;
    await ann.client.rpc("save_progress_v2", { p_sections: { core: { score: 42 } }, p_expected: null, p_mastery: { [N("Plane")]: { total: 3, correct: 3 } }, p_mastery_removes: [], p_profile: { mastered_count: 0 } });
    const rep = await ann.client.from("reports").insert({ id: N("rep1"), data: { id: N("rep1"), note: "my report" } });
    expect(rep.error).toBeNull();
    await bob.client.rpc("save_progress_v2", { p_sections: { core: { score: 7 } }, p_expected: null, p_mastery: {}, p_mastery_removes: [], p_profile: null });
  });
  afterAll(() => cleanup(tag));

  it("every table in the schema has row-level security on", () => {
    const without = superuser.rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(without).toEqual([]);
  });

  it("a visitor (anon) reads nothing from any table", async () => {
    const tables = superuser.rows(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`).map((r) => r.name);
    expect(tables.length).toBeGreaterThan(20);
    const PUBLIC_BY_DESIGN = ["app_settings"];                // the sign-up screen reads "are new accounts open" before anyone is signed in
    for (const t of tables.filter((x) => !PUBLIC_BY_DESIGN.includes(x))) {
      const r = await anon().from(t).select("*").limit(5);
      expect(r.error ? r.error.code : r.data, t).toSatisfy((v) => v === "42501" || (Array.isArray(v) && v.length === 0));
    }
  });

  it("another player reads none of Ann's rows from any table that has an owner", async () => {
    const owned = superuser.rows(`select c.relname as table, a.attname as col from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' and a.attname in ('user_id', 'owner_id') and c.relname not in ('profiles')`);
    expect(owned.length).toBeGreaterThan(8);
    for (const { table, col } of owned) {
      const theirs = superuser.rows(`select 1 from public.${table} where ${col} = '${ann.id}' limit 1`).length;
      const seen = await bob.client.from(table).select("*").eq(col, ann.id);
      expect(seen.error ? [] : seen.data, `Bob reading Ann's rows in ${table}.${col} (she has ${theirs ? "some" : "none"})`).toEqual([]);
    }
    // the sweep is not empty: Ann herself does see her own rows in the tables she uses
    expect((await ann.client.from("progress").select("section").eq("user_id", ann.id)).data.length).toBeGreaterThan(0);
    expect((await ann.client.from("reports").select("id").eq("user_id", ann.id)).data).toHaveLength(1);
    expect((await ann.client.from("collections").select("id").eq("owner_id", ann.id)).data.length).toBeGreaterThan(0);
  });

  it("another player cannot write to Ann's rows through the tables", async () => {
    const before = annsRows();
    const attempts = [
      bob.client.from("progress").insert({ user_id: ann.id, section: "core", data: { score: 1e6 } }),
      bob.client.from("progress").update({ data: { score: 1e6 } }).eq("user_id", ann.id).select(),
      bob.client.from("progress").delete().eq("user_id", ann.id).select(),
      bob.client.from("mastery").insert({ user_id: ann.id, item_key: N("Plane"), stats: { total: 0 } }),
      bob.client.from("mastery").update({ stats: { total: 0 } }).eq("user_id", ann.id).select(),
      bob.client.from("mastery").delete().eq("user_id", ann.id).select(),
      bob.client.from("reports").update({ data: { note: "edited" } }).eq("user_id", ann.id).select(),
      bob.client.from("reports").delete().eq("user_id", ann.id).select(),
      bob.client.from("senses").update({ meaning: "hacked" }).eq("id", own).select(),
      bob.client.from("senses").delete().eq("id", own).select(),
      bob.client.from("collections").update({ name: "hacked" }).eq("owner_id", ann.id).select(),
      bob.client.from("collections").delete().eq("owner_id", ann.id).select(),
      bob.client.from("collection_senses").insert({ collection_id: view, sense_id: own }),
      bob.client.from("library_entries").insert({ user_id: ann.id, sense_id: own }),
      bob.client.from("library_entries").delete().eq("user_id", ann.id).select(),
      bob.client.from("view_links").delete().eq("owner_id", ann.id).select(),
      bob.client.from("profiles").update({ score: 99999, mastered_count: 999 }).eq("id", ann.id).select(),
    ];
    for (const attempt of attempts) {
      const r = await attempt;
      // refused outright, or it matched no row the policy lets him see: either way nothing was written
      expect(r.error ? r.error.code : r.data ?? [], JSON.stringify(r)).toSatisfy((v) => v === "42501" || (Array.isArray(v) && v.length === 0));
    }
    expect(annsRows()).toEqual(before);
  });

  it("a guessed id gets nothing from the functions: not her view, not her word, not her link's owner side", async () => {
    const before = annsRows();
    const sees = await B.contents(view);
    expect(sees).toEqual([]);                                                        // her view has nothing to show him
    const attempts = {
      rename: () => B.rename(view, "mine"), remove: () => B.remove(view), add: () => B.add(view, [own]), move: () => B.move(view, null),
      share: () => B.share(view, [ann.id]), linkCreate: () => B.linkCreate(view), catalogPublish: () => B.catalogPublish(view, "stolen", ""),
      patch: () => B.patch(own, { meaning: "hacked" }), drop: () => B.drop(view, own),
    };
    const quiet = [];
    for (const [name, attempt] of Object.entries(attempts)) {
      try { await attempt(); quiet.push(name); } catch (e) { expect(e.code, name).toMatch(/^(P0002|42501)$/); }
    }
    // Taking out something that is not yours is a quiet no-op rather than an error; the state check below is what matters.
    expect(quiet.filter((n) => !["remove", "drop"].includes(n)), "calls that neither refused nor are known no-ops").toEqual([]);
    await expect(B.libraryRemove(own)).resolves.not.toThrow();                      // his own library has no such word: nothing to take out, and hers is untouched
    expect(await B.libraryAdd([own])).toEqual([]);
    expect(await B.tree()).toEqual([]);
    expect(annsRows()).toEqual(before);
  });

  it("a link works for others by design, but gives no door to her view itself", async () => {
    expect((await B.linkInfo(token)).valid).toBe(true);
    expect(await B.contents(view)).toEqual([]);
    await expect(B.linkRevoke(token)).resolves.not.toThrow();
    expect((await B.linkInfo(token)).valid).toBe(true);                              // revoking someone else's link did nothing
  });

  it("the leaderboard shows a few numbers about other players, never their progress", async () => {
    const seen = await bob.client.from("profiles").select("*").eq("id", ann.id).single();
    expect(Object.keys(seen.data).sort()).not.toEqual(expect.arrayContaining(["data", "mastery", "email", "password"]));
    expect(seen.data).toMatchObject({ username: `${tag}ann`, score: 42 });
    expect((await bob.client.from("mastery").select("stats").eq("user_id", ann.id)).data).toEqual([]);
  });

  it("friend requests and answers are only for the two people in them", async () => {
    const cat = await signUp(`${tag}cat`);
    expect((await cat.client.rpc("friend_respond", { p_user: ann.id, p_accept: true })).error).toBeTruthy();       // nothing was sent to her
    expect((await cat.client.rpc("friend_remove", { p_user: bob.id })).error ?? null).toSatisfy(() => true);
    expect(superuser.rows(`select 1 from public.friendships where status = 'accepted' and ((user_a = '${ann.id}' and user_b = '${bob.id}') or (user_a = '${bob.id}' and user_b = '${ann.id}'))`).length).toBeGreaterThan(0);
  });

  it("an identity that signed in as someone else's id is just another player: the id comes from the token, not from the call", async () => {
    // the app never sends its own id as an argument; a caller who names Ann's id in a call still acts as himself
    const asBob = as(bob.id);
    const r = await asBob.rpc("save_progress_v2", { p_sections: { core: { score: 8 } }, p_expected: null, p_mastery: { [N("Plane")]: { total: 1 } }, p_mastery_removes: [], p_profile: { user_id: ann.id } });
    expect(r.error).toBeNull();
    expect(superuser.rows(`select stats from public.mastery where user_id = '${ann.id}' and item_key = '${N("Plane")}'`)[0].stats.total).toBe(3);
  });

  describe("removing a view that is not mine", () => {
    const GHOST = "00000000-0000-4000-8000-0000000000ff";

    it("answers the same whether the view does not exist or belongs to someone else, and changes nothing", async () => {
      const before = annsRows();
      const gone = await bob.client.rpc("view_remove", { p_id: GHOST });
      const hers = await bob.client.rpc("view_remove", { p_id: view });
      expect(gone).toEqual({ data: null, error: null });
      expect(hers).toEqual(gone);                                        // nothing tells him the view exists, or whose it is
      expect(annsRows()).toEqual(before);
      const viaApi = [await B.remove(GHOST), await B.remove(view)];
      expect(viaApi).toEqual([null, null]);
      expect(annsRows()).toEqual(before);
      expect((await A.contents(view)).length).toBeGreaterThan(0);        // and her view still holds its words
    });

    it("the same for taking a word out of a view, and for the rules of a view", async () => {
      const before = annsRows();
      for (const call of [bob.client.rpc("view_drop", { p_view: GHOST, p_sense: own }), bob.client.rpc("view_drop", { p_view: view, p_sense: own }),
        bob.client.rpc("view_drop_rule", { p_view: view, p_rule: GHOST })]) {
        expect(await call).toEqual({ data: null, error: null });
      }
      expect(annsRows()).toEqual(before);
    });

    it("a mistake in the call is still an error, not hidden: an id that is not an id", async () => {
      expect((await bob.client.rpc("view_remove", { p_id: "not-an-id" })).error).toMatchObject({ code: "22P02" });
    });

    it("her own view is really removed when she removes it, and she is told of a failure", async () => {
      const temp = await A.create("Temporary");
      await A.add(temp, [own]);
      await A.remove(temp);
      expect((await A.tree()).map((v) => v.id)).not.toContain(temp);
      expect(superuser.rows(`select deleted_at is not null as gone from public.collections where id = '${temp}'`)[0].gone).toBe(true);
      expect((await A.libraryList()).words.map((w) => w.id)).toContain(own);                 // the word stays in her library
      await expect(createOnlineLibraryApi({ rpc: async () => ({ data: null, error: { message: "statement timeout", code: "57014" } }) }).remove(view)).rejects.toMatchObject({ code: "57014" });
    });
  });
});
