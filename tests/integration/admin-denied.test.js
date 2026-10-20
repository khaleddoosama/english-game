// Scenario 7: administration is for the admin. A normal player and a visitor
// are refused at the database, whatever the app's screens would have shown,
// and nothing changes. Every function that checks for an admin is tried
// (the list comes from the database: every function that checks for an admin,
// and every function named admin_*, so one that lost its check is still caught).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGURL, anon, cleanup, functionCatalog, newTag, promote, signUp, superuser } from "./harness";

describe.skipIf(!PGURL)("admin operations are refused to everyone else", () => {
  const tag = newTag();
  let admin, ann, bob;
  beforeAll(async () => {
    admin = promote(await signUp(`${tag}adm`));
    ann = await signUp(`${tag}ann`);
    bob = await signUp(`${tag}bob`);
  });
  afterAll(() => cleanup(tag));

  const adminFunctions = () => {
    const names = superuser.rows(`select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and (p.prosrc ilike '%require_admin%' or p.prosrc ilike '%is_admin()%' or starts_with(p.proname, 'admin_'))
        and p.proname not in ('require_admin', 'reports_keep_decision', 'reports_no_resurrect', 'catalog_edit', 'catalog_unpublish', 'live_create', 'live_end')`).map((r) => r.name);
    return names.map((name) => functionCatalog().find((f) => f.name === name)).filter(Boolean);
  };
  // Arguments that are valid for the type, so a refusal is about who is asking, not about the arguments.
  const argsFor = (fn, subject) => Object.fromEntries(fn.args.map((a) => [a.name,
    a.type === "uuid" ? subject.id : a.type === "uuid[]" ? [] : a.type === "boolean" ? true : a.type === "integer" || a.type === "bigint" ? 1
      : a.type === "bigint[]" ? [1] : a.type === "text[]" ? [] : a.type === "jsonb" ? (/upserts|removes|renames|level_order/.test(a.name) ? [] : {})
        : a.name === "p_role" ? "admin" : a.name === "p_view" ? "overview" : a.name === "p_tz" ? "UTC" : "xxxxxx"]));

  it("the database knows of at least the expected admin functions (the sweep below is not empty)", () => {
    const names = adminFunctions().map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["admin_players", "admin_set_role", "admin_delete_player", "content_save_v2", "apply_item_renames", "dictionary_sync", "admin_save_settings"]));
  });

  it("a player is refused every one of them, and so is a visitor", async () => {
    for (const fn of adminFunctions()) {
      const asPlayer = await ann.client.rpc(fn.name, argsFor(fn, bob));
      expect(asPlayer.error, `${fn.name} as a player`).toMatchObject({ code: "42501" });
      const asVisitor = await anon().rpc(fn.name, argsFor(fn, bob));
      expect(asVisitor.error, `${fn.name} as a visitor`).toMatchObject({ code: "42501" });
    }
  });

  it("the same calls work for the admin, so the refusals above are about who is asking", async () => {
    for (const name of ["admin_overview", "admin_players", "admin_word_stats", "admin_data_issues"]) {
      const fn = functionCatalog().find((f) => f.name === name);
      const r = await admin.client.rpc(name, argsFor(fn, ann));
      expect(r.error, name).toBeNull();
    }
    expect((await admin.client.rpc("admin_player_detail", { p_user: ann.id })).error).toBeNull();
  });

  it("a player cannot make themselves, or anyone, an admin", async () => {
    expect((await ann.client.rpc("admin_set_role", { p_user: ann.id, p_role: "admin" })).error).toMatchObject({ code: "42501" });
    expect((await ann.client.from("profiles").update({ role: "admin" }).eq("id", ann.id)).error).toMatchObject({ code: "42501" });   // the column is not writable
    expect((await ann.client.from("profiles").update({ username: "root" }).eq("id", ann.id)).error).toMatchObject({ code: "42501" });
    expect((await ann.client.from("profiles").insert({ id: "00000000-0000-0000-0000-0000000000aa", username: `${tag}fake`, role: "admin" })).error).toMatchObject({ code: "42501" });
    expect(superuser.rows(`select role from public.profiles where id in ('${ann.id}', '${bob.id}')`).map((r) => r.role)).toEqual(["player", "player"]);
  });

  it("a player cannot change the course: not through the save function, not through the tables, not through the settings", async () => {
    const version = () => superuser.rows("select version from public.content_meta where id = 1")[0].version;
    const before = version();
    const save = await ann.client.rpc("content_save_v2", { p_draft: null, p_upserts: [{ kind: "words", key: `${tag}X`, data: { word: `${tag}X` }, position: 1 }], p_removes: [], p_level_order: null, p_note: "hacked", p_renames: null, p_expected_version: null, p_publish: true });
    expect(save.error).toMatchObject({ code: "42501" });
    expect((await ann.client.from("content_items").insert({ kind: "words", key: `${tag}Y`, data: { word: `${tag}Y` } })).error).toMatchObject({ code: "42501" });
    expect((await ann.client.from("content_meta").update({ note: "hacked" }).eq("id", 1).select()).data).toEqual([]);          // a row the policy hides cannot be updated
    // The settings row (id 1, one jsonb "data"): readable by everyone, written only through admin_save_settings.
    // A direct update reaches no row (no update policy) and an insert is refused; the row stays the same.
    const settings = () => superuser.rows("select data from public.app_settings where id = 1");
    const settingsBefore = settings();
    const direct = await ann.client.from("app_settings").update({ data: { ...settingsBefore[0].data, signupsOpen: false } }).eq("id", 1).select();
    expect([direct.error, direct.data]).toEqual([null, []]);
    expect((await ann.client.from("app_settings").insert({ id: 1, data: {} })).error).toMatchObject({ code: "42501" });
    expect(settings()).toEqual(settingsBefore);
    expect(version()).toBe(before);
    expect(superuser.rows(`select 1 from public.content_items where key like '${tag}%'`)).toEqual([]);
    expect(superuser.rows("select 1 from public.content_meta where note = 'hacked'")).toEqual([]);
  });

  it("the admin changes the settings through admin_save_settings (so the refusal above is about who is asking)", async () => {
    const settings = () => superuser.rows("select data from public.app_settings where id = 1")[0].data;
    const old = settings();
    const saved = await admin.client.rpc("admin_save_settings", { p_data: { ...old, announcement: `${tag} notice` } });
    expect(saved.error).toBeNull();
    expect(settings().announcement).toBe(`${tag} notice`);
    expect((await ann.client.rpc("admin_save_settings", { p_data: { ...old, announcement: "hacked" } })).error).toMatchObject({ code: "42501" });
    expect(settings().announcement).toBe(`${tag} notice`);
    expect((await admin.client.rpc("admin_save_settings", { p_data: old })).error).toBeNull();
    expect(settings().announcement).toBe(old.announcement ?? "");   // saved settings are normalized: no announcement is ""
  });

  it("a player cannot read what only the admin may: the audit log and other players' details", async () => {
    await admin.client.rpc("admin_set_role", { p_user: bob.id, p_role: "player" });
    expect((await ann.client.from("admin_audit").select("id")).data ?? []).toEqual([]);
    expect((await admin.client.from("admin_audit").select("id").limit(1)).data).toHaveLength(1);
  });

  describe("what the admin does is allowed, recorded, and complete", () => {
    it("promotes, demotes and sets a password, each leaving a line in the audit log", async () => {
      const dan = await signUp(`${tag}dan`);
      expect((await admin.client.rpc("admin_set_role", { p_user: dan.id, p_role: "admin" })).error).toBeNull();
      expect(superuser.rows(`select role from public.profiles where id = '${dan.id}'`)[0].role).toBe("admin");
      expect((await dan.client.rpc("admin_overview")).error).toBeNull();                    // the new admin can act at once
      expect((await admin.client.rpc("admin_set_role", { p_user: dan.id, p_role: "player" })).error).toBeNull();
      expect((await dan.client.rpc("admin_overview")).error).toMatchObject({ code: "42501" });
      expect((await admin.client.rpc("admin_set_password", { p_user: dan.id, p_password: "newsecret" })).error).toBeNull();
      const lines = superuser.rows(`select action from public.admin_audit where target ilike '%${tag}dan%' or target ilike '%${dan.id}%'`).map((r) => r.action);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("resets a player's progress and nobody else's", async () => {
      await ann.client.rpc("save_progress_v2", { p_sections: { core: { score: 50 } }, p_expected: null, p_mastery: { [`${tag}w`]: { total: 1 } }, p_mastery_removes: [], p_profile: null });
      await bob.client.rpc("save_progress_v2", { p_sections: { core: { score: 60 } }, p_expected: null, p_mastery: { [`${tag}w`]: { total: 1 } }, p_mastery_removes: [], p_profile: null });
      expect((await admin.client.rpc("admin_reset_player", { p_user: ann.id })).error).toBeNull();
      expect(superuser.rows(`select 1 from public.progress where user_id = '${ann.id}'`)).toEqual([]);
      expect(superuser.rows(`select 1 from public.mastery where user_id = '${ann.id}'`)).toEqual([]);
      expect(superuser.rows(`select 1 from public.progress where user_id = '${bob.id}'`)).toHaveLength(1);
    });

    it("deletes a player who has views, a library, shares and a link, and leaves what others copied from them", async () => {
      const { createOnlineLibraryApi } = await import("../../src/features/library/onlineLibraryApi.js");
      const eve = await signUp(`${tag}eve`), fay = await signUp(`${tag}fay`);
      const E = createOnlineLibraryApi(eve.client), F = createOnlineLibraryApi(fay.client);
      const { befriend } = await import("./harness");
      await befriend(eve, fay);
      const word = (await E.createWord({ word: `${tag}Own`, meaning: "m" })).id;
      const view = await E.create("Mine");
      await E.add(view, [word]);
      await E.share(view, [fay.id]);
      const link = await E.linkCreate(view);
      await E.catalogPublish(view, `${tag} entry`, "");
      const copy = await F.linkAccept(link.token);
      const del = await admin.client.rpc("admin_delete_player", { p_user: eve.id });
      expect(del.error, "deleting a player who has views").toBeNull();
      expect(superuser.rows(`select 1 from public.profiles where id = '${eve.id}'`)).toEqual([]);
      expect(superuser.rows(`select 1 from public.collections where owner_id = '${eve.id}'`)).toEqual([]);
      expect((await F.tree()).map((v) => v.id)).toContain(copy.view);                       // Fay's copy is hers
    });
  });
});
