// The local mirror against the real SQL functions: the same random sequence of
// library and view operations goes through both, and they must agree on every
// step (both succeed or both refuse) and on the state they end up in. The
// operations are seeded, so a failure names the seed and the step that differs.
// Runs only when PGURL points at a database with the migrations applied:
//   PGURL=postgres://postgres:postgres@localhost:5432/libci npx vitest run tests/library-differential.test.js
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createLocalLibraryApi, createSupabaseLibraryApi } from "../src/features/library/libraryApi.js";

const PGURL = process.env.PGURL;
const psql = (sql) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At", "-q"], { input: sql, encoding: "utf8" }).trim();
const UUID_ARRAYS = new Set(["p_senses", "p_rules", "p_users"]);
const lit = (v, key) => v === null || v === undefined ? "null"
  : Array.isArray(v) ? `array[${v.map((x) => lit(x)).join(",")}]::${UUID_ARRAYS.has(key) ? "uuid" : "text"}[]`
  : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  : typeof v === "boolean" || typeof v === "number" ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
const SETOF = new Set(["view_contents", "library_add"]);
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

// a small seeded random generator
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const NAMES = ["A", "B", "C", "d", "a", "movies", "x y", "A1.1", "Z"];

describe.skipIf(!PGURL)("the local mirror and the SQL functions agree", () => {
  const WORDS = 8, RULES = 4;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const seed of seeds) {
    it(`seed ${seed}: 100 random operations`, async () => {
      const tag = `df${Date.now() % 100000}s${seed}`;
      psql(`select public.register_player('${tag}', 'secret1');`);
      const user = psql(`select id from public.profiles where username = '${tag}'`);
      const h = psql(`insert into public.headwords (text) values ('${tag}word') returning id`).split("\n")[0];
      const wordIds = Array.from({ length: WORDS }, (_, i) => psql(`insert into public.senses (headword_id, label, meaning) values ('${h}', 'l${i}', 'm${i}') returning id`).split("\n")[0]);
      const ruleIds = Array.from({ length: RULES }, (_, i) => psql(`insert into public.grammar_rules (rule) values ('${tag} rule ${i}') returning id`).split("\n")[0]);
      const keyOfWord = new Map(wordIds.map((id, i) => [id, `w${i}`])), keyOfRule = new Map(ruleIds.map((id, i) => [id, `r${i}`]));
      const store = new Map();
      const local = createLocalLibraryApi({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }, me: () => "me" });
      const online = createSupabaseLibraryApi(clientAs(user));

      // a view is named by its place in the list of paths, the same in both
      const views = async (api) => (await api.tree()).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const snapshot = async (api, mapWord, mapRule) => {
        const vs = await views(api);
        const rows = [];
        for (const v of vs) {
          const c = await api.contents(v.id, false);
          rows.push([v.path, c.filter((x) => x.kind === "sense").map((x) => mapWord(x.id)).sort(), c.filter((x) => x.kind === "rule").map((x) => mapRule(x.id)).sort()]);
        }
        const lib = await api.libraryList();
        return { rows, lib: lib.words.map((w) => mapWord(w.id)).sort(), rules: lib.rules.map((r) => mapRule(r.id)).sort() };
      };
      const snap = async () => [await snapshot(local, (x) => x, (x) => x), await snapshot(online, (x) => keyOfWord.get(x), (x) => keyOfRule.get(x))];

      const next = rng(seed);
      const pick = (list) => list[Math.floor(next() * list.length)];
      const sample = (n, pool) => [...new Set(Array.from({ length: n }, () => pick(pool)))];
      const ops = ["create", "create", "create", "rename", "move", "remove", "add", "add", "drop", "addRules", "dropRule", "libraryRemove", "libraryRemoveRule", "libraryAdd", "libraryAddRules"];
      const wkeys = Array.from({ length: WORDS }, (_, i) => `w${i}`), rkeys = Array.from({ length: RULES }, (_, i) => `r${i}`);

      for (let step = 0; step < 100; step++) {
        const op = pick(ops);
        const lv = await views(local), ov = await views(online);
        expect(lv.map((v) => v.path), `seed ${seed} step ${step}: the views differ before ${op}`).toEqual(ov.map((v) => v.path));
        const at = lv.length ? Math.floor(next() * lv.length) : -1;           // which view, by place
        const to = next() < 0.3 ? -1 : Math.floor(next() * lv.length);       // a parent (or none)
        const name = pick(NAMES), ws = sample(1 + Math.floor(next() * 3), wkeys), rs = sample(1 + Math.floor(next() * 2), rkeys), w1 = pick(wkeys), r1 = pick(rkeys);
        const toId = (list, i) => (i >= 0 && i < list.length ? list[i].id : null);
        const idW = (k) => wordIds[Number(k.slice(1))], idR = (k) => ruleIds[Number(k.slice(1))];
        const calls = {
          create: [(a, l) => a.create(name, toId(l, to)), 1],
          rename: [(a, l) => a.rename(toId(l, at), name), 1],
          move: [(a, l) => a.move(toId(l, at), toId(l, to)), 1],
          remove: [(a, l) => a.remove(toId(l, at)), 1],
          add: [(a, l, map) => a.add(toId(l, at), ws.map(map.w)), 1],
          drop: [(a, l, map) => a.drop(toId(l, at), map.w(w1)), 1],
          addRules: [(a, l, map) => a.addRules(toId(l, at), rs.map(map.r)), 1],
          dropRule: [(a, l, map) => a.dropRule(toId(l, at), map.r(r1)), 1],
          libraryRemove: [(a, l, map) => a.libraryRemove(map.w(w1)), 0],
          libraryRemoveRule: [(a, l, map) => a.libraryRemoveRule(map.r(r1)), 0],
          libraryAdd: [(a, l, map) => a.libraryAdd(ws.map(map.w)), 0],
          libraryAddRules: [(a, l, map) => a.libraryAddRules(rs.map(map.r)), 0],
        };
        const [run] = calls[op];
        const run1 = async (api, list, map) => { try { await run(api, list, map); return "ok"; } catch { return "refused"; } };
        const a = await run1(local, lv, { w: (k) => k, r: (k) => k });
        const b = await run1(online, ov, { w: idW, r: idR });
        expect(a, `seed ${seed} step ${step}: ${op} (${name}, view #${at}, parent #${to}) was ${a} locally and ${b} on the server`).toBe(b);
        if (step % 10 === 9) {
          const [l, o] = await snap();
          expect(l, `seed ${seed} step ${step}: the state differs after ${op}`).toEqual(o);
        }
      }
      const [l, o] = await snap();
      expect(l, `seed ${seed}: the final state differs`).toEqual(o);
    }, 300000);
  }
});
