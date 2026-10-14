// The online library API against the real SQL functions (migrations
// 0026-0029) in a throwaway Postgres: the argument names, and the shape of
// what comes back, are what the app and the database must agree on. Runs
// only when PGURL points at a database that has the migrations applied
// (supabase/ci/run-tests.sh sets one up):
//   PGURL=postgres://postgres:postgres@localhost:5432/libci npx vitest run tests/library-contract.test.js
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createSupabaseLibraryApi } from "../src/features/library/libraryApi.js";

const PGURL = process.env.PGURL;
const psql = (sql) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At", "-q"], { input: sql, encoding: "utf8" }).trim();
// PostgREST types each argument from the function's signature; here the uuid arrays are told apart by name.
const UUID_ARRAYS = new Set(["p_senses", "p_rules", "p_users"]);
const lit = (v, key) => v === null || v === undefined ? "null"
  : Array.isArray(v) ? `array[${v.map((x) => lit(x)).join(",")}]::${UUID_ARRAYS.has(key) ? "uuid" : "text"}[]`
  : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  : typeof v === "boolean" ? String(v)
  : typeof v === "number" ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
const SETOF = new Set(["view_contents", "library_add"]);

// supabase-js style: rpc(name, namedArgs) -> { data, error }, signed in as `user`.
const clientAs = (user) => ({
  rpc: async (fn, args = {}) => {
    const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v, k)}`).join(", ");
    const call = `public.${fn}(${named})`;
    const q = SETOF.has(fn) ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} t` : `select to_jsonb(${call})`;
    try {
      const out = psql(`select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false);\n${q};`).split("\n").pop();
      return { data: out === "" || out === "null" ? null : JSON.parse(out), error: null };
    } catch (e) {
      const m = String(e.stderr || "").match(/ERROR:\s+(\w{5}):\s+(.*)/);
      return { data: null, error: Object.assign(new Error(m?.[2] || String(e.message)), { code: m?.[1] }) };
    }
  },
});

describe.skipIf(!PGURL)("library API <-> SQL functions", () => {
  const tag = `ct${Date.now() % 100000}`;
  let a, b, s1, s2, s3, r1;
  const setup = () => {
    psql(`select public.register_player('${tag}a', 'secret1'); select public.register_player('${tag}b', 'secret1');`);
    a = psql(`select id from public.profiles where username = '${tag}a'`);
    b = psql(`select id from public.profiles where username = '${tag}b'`);
    const h = psql(`insert into public.headwords (text) values ('${tag}word') returning id`).split("\n")[0];
    const ins = (label) => psql(`insert into public.senses (headword_id, label, meaning) values ('${h}', '${label}', 'm ${label}') returning id`).split("\n")[0];
    s1 = ins("one"); s2 = ins("two"); s3 = ins("three");
    r1 = psql(`insert into public.grammar_rules (rule) values ('${tag} rule') returning id`).split("\n")[0];
    psql(`select set_config('request.jwt.claims', '{"sub":"${a}","role":"authenticated"}', false); select public.friend_request('${tag}b');`);
    psql(`select set_config('request.jwt.claims', '{"sub":"${b}","role":"authenticated"}', false); select public.friend_respond('${a}', true);`);
  };

  it("views, words, rules, library changes and sharing, through the same calls the app makes", async () => {
    setup();
    const A = createSupabaseLibraryApi(clientAs(a)), B = createSupabaseLibraryApi(clientAs(b));
    // views inside views
    const top = await A.create("A1.1");
    const sub = await A.create("movies", top);
    expect(typeof top).toBe("string");
    expect((await A.tree()).map((v) => v.path)).toEqual(["A1.1", "A1.1::movies"]);
    expect(await A.add(sub, [s1, s2])).toBe(2);
    expect(await A.addRules(sub, [r1])).toBe(1);
    // what is inside: rows of { kind, id }
    const deep = await A.contents(top, true);
    expect(deep).toEqual(expect.arrayContaining([{ kind: "sense", id: s1 }, { kind: "sense", id: s2 }, { kind: "rule", id: r1 }]));
    expect(await A.contents(top, false)).toEqual([]);
    expect((await A.tree()).find((v) => v.id === sub)).toMatchObject({ words: 2, rules: 1, parent: top, name: "movies" });
    // rename / move / drop / library
    await A.rename(sub, "films");
    expect((await A.tree()).find((v) => v.id === sub).path).toBe("A1.1::films");
    await A.move(sub, null);
    expect((await A.tree()).find((v) => v.id === sub).path).toBe("films");
    await A.drop(sub, s2);
    expect((await A.contents(sub, false)).filter((x) => x.kind === "sense")).toEqual([{ kind: "sense", id: s1 }]);
    await A.patch(s1, { meaning: "mine" }, "note");
    await A.libraryRemove(s1);
    expect((await A.contents(sub, false)).filter((x) => x.kind === "sense")).toEqual([]);
    expect((await A.libraryAdd([s1, s3])).length).toBe(2);
    // errors come back as errors with the server's message and code
    await expect(A.create("a::b")).rejects.toMatchObject({ message: expect.stringContaining("::"), code: "22023" });
    await expect(B.add(top, [s1])).rejects.toThrow(/does not exist/);
    // sharing: only friends, inbox shape, accept result shape
    await A.add(top, [s1, s3]);
    expect(await A.share(top, [b])).toBe(1);
    expect(await A.share(top, [b])).toBe(0);
    const inbox = await B.inbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ name: "A1.1", from: `${tag}a`, words: 2 });
    const got = await B.accept(inbox[0].id);
    expect(got).toMatchObject({ name: `A1.1 (from ${tag}a)`, words: 2, skipped: 0 });
    expect((await B.contents(got.view, true)).map((x) => x.id).sort()).toEqual([s1, s3].sort());
    expect(await B.inbox()).toEqual([]);
    await A.share(top, [b]);
    await B.dismiss((await B.inbox())[0].id);
    expect(await B.inbox()).toEqual([]);
    // a word of my own: private, in my library, the same card twice gives the same row
    const mine = await A.createWord({ word: "Quokka", type: "vocab", partsOfSpeech: ["noun"], category: "Animals", meaning: "A small marsupial", situation: "We saw one.", _aiAdded: true });
    expect(mine).toMatchObject({ existing: false });
    expect((await A.createWord({ word: "quokka", meaning: "again" })).id).toBe(mine.id);
    expect(await A.add(sub, [mine.id])).toBe(1);
    await expect(B.add(top, [mine.id])).rejects.toThrow();
    // by link: make, look, take, take back; and my library as a list
    const link = await A.linkCreate(top);
    expect(link.token.length).toBeGreaterThan(20);
    expect(await B.linkInfo(link.token)).toMatchObject({ valid: true, name: "A1.1", from: `${tag}a`, mine: false });
    const taken = await B.linkAccept(link.token);
    expect(taken).toMatchObject({ name: expect.stringContaining(`(from ${tag}a)`), skipped: 0 });
    expect((await B.linkAccept(link.token)).already).toBe(true);
    await A.linkRevoke(link.token);
    expect(await B.linkInfo(link.token)).toEqual({ valid: false, reason: "taken_back" });
    await expect(B.linkAccept(link.token)).rejects.toThrow(/no longer works/);
    // grammar rules in the library: add, put in a view, take out of the view, take out of the library
    await A.libraryRemoveRule(r1);
    expect((await A.libraryList()).rules.map((r) => r.id)).not.toContain(r1);
    expect(await A.libraryAddRules([r1])).toBe(1);
    expect(await A.libraryAddRules([r1])).toBe(0);
    await A.dropRule(sub, r1);
    // the catalog: publish, browse, take, take down
    const entry = await A.catalogPublish(top, "Contract view", "for the test");
    expect(entry).toMatchObject({ id: expect.any(String), title: "Contract view" });
    expect((await B.catalogList("contract view", 10))[0]).toMatchObject({ id: entry.id, from: `${tag}a`, mine: false, taken: false, words: expect.any(Number) });
    expect(await B.catalogTake(entry.id)).toMatchObject({ view: expect.any(String), skipped: expect.any(Number) });
    await A.catalogUnpublish(entry.id);
    expect(await B.catalogList("contract view", 10)).toEqual([]);
    const list = await A.libraryList();
    expect(list.words.length).toBeGreaterThan(0);
    expect(list.words[0]).toEqual(expect.objectContaining({ id: expect.any(String), views: expect.any(Number) }));
    // remove a view: gone from the tree, words stay in the library
    await A.remove(top);
    expect((await A.tree()).map((v) => v.id)).toEqual([sub]);
  }, 120000);
});
