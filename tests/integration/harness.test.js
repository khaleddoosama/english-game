// The harness itself: if these fail, nothing else in tests/integration means anything.
import { afterAll, describe, expect, it } from "vitest";
import { createOnlineLibraryApi } from "../../src/features/library/onlineLibraryApi.js";
import { PGURL, anon, as, befriend, cleanup, newTag, signUp, superuser } from "./harness";

describe.skipIf(!PGURL)("the harness acts as a real role", () => {
  const tag = newTag();
  afterAll(() => cleanup(tag));

  it("anon is anon: no profiles are readable, and auth.uid() is null", async () => {
    const a = await signUp(`${tag}a`);
    expect((await anon().from("profiles").select("id")).data).toEqual([]);
    expect(superuser.rows("select count(*)::int as n from public.profiles")[0].n).toBeGreaterThan(0);   // they are there; RLS hides them
    const own = await a.client.from("profiles").select("id, username, role").eq("id", a.id).single();
    expect(own.data).toMatchObject({ id: a.id, username: `${tag}a`, role: "player" });
  });

  it("an error carries the SQLSTATE the database raised", async () => {
    const a = await signUp(`${tag}b`);
    const r = await a.client.rpc("view_create", { p_name: "a::b" });
    expect(r.error).toMatchObject({ code: "22023", message: expect.stringContaining("no \"::\"") });
    expect((await a.client.rpc("no_such_function", {})).error.code).toBe("PGRST202");
  });

  it("a call is a transaction: a failed call leaves nothing behind", async () => {
    const a = await signUp(`${tag}c`);
    await a.client.rpc("view_create", { p_name: "keep" });
    await a.client.rpc("view_create", { p_name: "keep" });                // refused: name taken
    const tree = await a.client.rpc("view_tree"); expect(tree.error).toBeNull();
    expect(tree.data.filter((v) => v.name === "keep")).toHaveLength(1);
  });

  it("an identity that is not a user sees nothing and writes nothing", async () => {
    const nobody = as("00000000-0000-0000-0000-000000000000");
    expect((await nobody.from("progress").select("section")).data).toEqual([]);
    expect((await nobody.rpc("view_create", { p_name: "x" })).error).toBeTruthy();
  });

  it("cleanup removes everything a test made, so a run can be repeated on the same database", async () => {
    const t = newTag();
    const eve = await signUp(`${t}eve`), fay = await signUp(`${t}fay`);
    await befriend(eve, fay);
    const E = createOnlineLibraryApi(eve.client);
    const w = (await E.createWord({ word: `${t}Word`, meaning: "m" })).id;
    const v = await E.create("Mine");
    await E.add(v, [w]);
    await E.share(v, [fay.id]);
    const l = await E.linkCreate(v);
    await createOnlineLibraryApi(fay.client).linkAccept(l.token);
    await E.catalogPublish(v, `${t} entry`, "");
    await eve.client.rpc("save_progress_v2", { p_sections: { core: { score: 1 } }, p_expected: null, p_mastery: { [`${t}k`]: { total: 1 } }, p_mastery_removes: [], p_profile: null });
    cleanup(t);
    const left = (table, col) => superuser.rows(`select count(*)::int as n from public.${table} where ${col}::text like '%${t}%'`)[0].n;
    for (const [table, col] of [["profiles", "username"], ["senses", "id"], ["collections", "name"], ["catalog_entries", "title"], ["mastery", "item_key"], ["headwords", "text"]]) {
      if (table === "senses") expect(superuser.rows(`select count(*)::int as n from public.senses s join public.headwords h on h.id = s.headword_id where h.text ilike '%${t}%'`)[0].n).toBe(0);
      else expect(left(table, col), table).toBe(0);
    }
    expect(superuser.rows(`select count(*)::int as n from auth.users where email like '${t}%'`)[0].n).toBe(0);
  });
});
