// Integration harness: a stand-in for supabase-js that talks to a REAL
// PostgreSQL that has every migration applied, one transaction per call,
// acting as the role PostgREST would use:
//
//   as("anon")            -> SET ROLE anon           (the publishable key, nobody signed in)
//   as(userId)            -> SET ROLE authenticated  + request.jwt.claims {sub, role}
//
// so row-level security and function grants apply exactly as they are in the
// migrations. The superuser connection (`superuser()`) exists only to build
// fixtures (promote the first admin, remove test accounts) and is never what a
// test's assertion goes through.
//
// What this is not: GoTrue (no passwords checked, no real JWTs), PostgREST
// itself (query strings are built here, not parsed there), Realtime or
// Storage. See docs/integration-tests.md.
import { execFileSync } from "node:child_process";

export const PGURL = process.env.PGURL;

const esc = (s) => String(s).replace(/'/g, "''");
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

// psql, one script in, the last line of output out.
function psql(sql, { all = false } = {}) {
  const out = execFileSync("psql", [PGURL, "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At", "-q"], { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
  return all ? out : out.split("\n").pop();
}

// supabase-js shaped error: { message, code }. PostgREST answers with the SQLSTATE of the failure.
function toError(e) {
  const stderr = String(e.stderr || e.message || "");
  const m = stderr.match(/ERROR:\s+(\w{5}):\s+(.*)/);
  return Object.assign(new Error(m?.[2] || stderr.trim()), { code: m?.[1] || "XX000", details: stderr });
}

// Runs `body` inside a transaction as `identity` and returns the parsed JSON of its last line.
function runAs(identity, body) {
  const claims = identity === "anon" ? { role: "anon" } : { sub: identity, role: "authenticated" };
  const role = identity === "anon" ? "anon" : "authenticated";
  const script = `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', '${esc(JSON.stringify(claims))}', true);\n${body};\ncommit;`;
  if (process.env.IT_TRACE) console.error(script);
  if (process.env.IT_TRACE) console.error(script);
  const out = psql(script, { all: true }).split("\n").filter((l) => l !== "COMMIT");
  const last = out[out.length - 1];
  return last === undefined || last === "" ? null : JSON.parse(last);
}

/* ------------------------------------------------------------ catalog */
let functionsCache = null;
function functions() {
  if (functionsCache) return functionsCache;
  // Input names only: a function that returns a table lists its columns in proargnames too.
  const raw = psql(`select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname, 'set', p.proretset, 'void', p.prorettype = 'void'::regtype, 'defaults', p.pronargdefaults,
      'args', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'type', format_type(a.t, null)) order by a.o), '[]'::jsonb)
               from unnest(
                 case when p.proargmodes is null then coalesce(p.proargnames, '{}'::text[])
                      else (select coalesce(array_agg(x.n order by x.o), '{}'::text[]) from unnest(p.proargnames, p.proargmodes) with ordinality as x(n, m, o) where x.m in ('i', 'b', 'v')) end,
                 string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality as a(name, t, o)))), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and (p.pronargs = 0 or p.proargnames is not null)`);
  functionsCache = JSON.parse(raw);
  return functionsCache;
}

// A value as an SQL expression of the function's declared argument type.
function literal(value, type) {
  if (value === null || value === undefined) return `null::${type}`;
  if (type === "jsonb" || type === "json") return `'${esc(JSON.stringify(value))}'::${type}`;
  if (type.endsWith("[]")) return `array(select jsonb_array_elements_text('${esc(JSON.stringify(value))}'::jsonb))::${type}`;
  return `'${esc(typeof value === "object" ? JSON.stringify(value) : value)}'::${type}`;
}

// The functions of the public schema and their (input) arguments, for tests that go through all of them.
export const functionCatalog = () => functions();

function rpc(identity, name, args = {}) {
  const given = Object.keys(args);
  const fn = functions().find((f) => f.name === name
    && given.every((g) => f.args.some((a) => a.name === g))
    && f.args.slice(0, f.args.length - f.defaults).every((a) => given.includes(a.name)));
  if (!fn) return { data: null, error: Object.assign(new Error(`Could not find the function public.${name}(${given.join(", ")}) in the schema cache`), { code: "PGRST202" }) };
  const named = fn.args.filter((a) => given.includes(a.name)).map((a) => `${ident(a.name)} => ${literal(args[a.name], a.type)}`).join(", ");
  const call = `public.${ident(name)}(${named})`;
  const body = fn.set ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} t` : fn.void ? `select ${call}` : `select to_jsonb(${call})`;
  try { const data = runAs(identity, body); return { data: fn.void ? null : data, error: null }; } catch (e) { return { data: null, error: toError(e) }; }
}

/* ------------------------------------------------------ table queries */
const tableMeta = new Map();
function meta(table) {
  if (!tableMeta.has(table)) {
    const raw = psql(`select jsonb_build_object(
      'pk', coalesce((select jsonb_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'public.${table}'::regclass and i.indisprimary), '[]'::jsonb),
      'fks', coalesce((select jsonb_agg(jsonb_build_object('col', a.attname, 'ref', c2.relname, 'refcol', a2.attname, 'refschema', n2.nspname))
                       from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
                       join pg_class c2 on c2.oid = k.confrelid join pg_namespace n2 on n2.oid = c2.relnamespace
                       join pg_attribute a2 on a2.attrelid = k.confrelid and a2.attnum = k.confkey[1]
                       where k.contype = 'f' and k.conrelid = 'public.${table}'::regclass), '[]'::jsonb),
      'rev', coalesce((select jsonb_agg(jsonb_build_object('table', c1.relname, 'col', a.attname, 'refcol', a2.attname))
                       from pg_constraint k join pg_class c1 on c1.oid = k.conrelid join pg_namespace n1 on n1.oid = c1.relnamespace
                       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
                       join pg_attribute a2 on a2.attrelid = k.confrelid and a2.attnum = k.confkey[1]
                       where k.contype = 'f' and k.confrelid = 'public.${table}'::regclass and n1.nspname = 'public'), '[]'::jsonb))`);
    tableMeta.set(table, JSON.parse(raw));
  }
  return tableMeta.get(table);
}

const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v)
  : typeof v === "object" ? `'${esc(JSON.stringify(v))}'::jsonb` : `'${esc(v)}'`);

// "id, label, headwords(text), profiles:user_id(username)" -> select list over alias t.
function selectList(table, cols) {
  if (!cols || cols === "*") return "t.*";
  const parts = []; let depth = 0, cur = "";
  for (const ch of cols) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch; }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/s);
    if (!m) return p === "*" ? "t.*" : `t.${ident(p)}`;
    const [, alias, hint, inner] = m;
    const info = meta(table);
    const viaCol = info.fks.find((f) => f.col === hint);
    const toOne = viaCol || info.fks.find((f) => f.ref === hint);
    const rel = viaCol ? viaCol.ref : hint;
    const innerCols = inner.split(",").map((c) => `r.${ident(c.trim())}`).join(", ");
    const name = alias || hint;
    if (toOne) {
      const refSchema = toOne.refschema === "public" ? "public" : toOne.refschema;
      return `(select to_jsonb(x) from (select ${innerCols} from ${refSchema}.${ident(toOne.ref)} r where r.${ident(toOne.refcol)} = t.${ident(toOne.col)}) x) as ${ident(name)}`;
    }
    const back = info.rev.find((f) => f.table === rel);
    if (!back) throw new Error(`No relationship between ${table} and ${rel}`);
    return `coalesce((select jsonb_agg(to_jsonb(x)) from (select ${innerCols} from public.${ident(rel)} r where r.${ident(back.col)} = t.${ident(back.refcol)}) x), '[]'::jsonb) as ${ident(name)}`;
  }).join(", ");
}

function from(identity, table) {
  const filters = [], orders = [];
  let op = "select", cols = "*", payload = null, range = null, single = null, returning = false, onConflict = null, ignoreDuplicates = false;
  const where = () => (filters.length ? ` where ${filters.join(" and ")}` : "");
  const q = {
    select(c = "*") { if (op === "select") cols = c; else returning = c || "*"; return q; },
    insert(rows) { op = "insert"; payload = rows; return q; },
    upsert(rows, o = {}) { op = "upsert"; payload = rows; onConflict = o.onConflict || null; ignoreDuplicates = !!o.ignoreDuplicates; return q; },
    update(values) { op = "update"; payload = values; return q; },
    delete() { op = "delete"; return q; },
    eq(c, v) { filters.push(`t.${ident(c)} = ${lit(v)}`); return q; },
    neq(c, v) { filters.push(`t.${ident(c)} <> ${lit(v)}`); return q; },
    gt(c, v) { filters.push(`t.${ident(c)} > ${lit(v)}`); return q; },
    gte(c, v) { filters.push(`t.${ident(c)} >= ${lit(v)}`); return q; },
    lt(c, v) { filters.push(`t.${ident(c)} < ${lit(v)}`); return q; },
    lte(c, v) { filters.push(`t.${ident(c)} <= ${lit(v)}`); return q; },
    in(c, vs) { filters.push(vs.length ? `t.${ident(c)} in (${vs.map(lit).join(", ")})` : "false"); return q; },
    is(c, v) { filters.push(`t.${ident(c)} is ${v === null ? "null" : v ? "true" : "false"}`); return q; },
    not(c, o, v) { filters.push(o === "is" ? `t.${ident(c)} is not ${v === null ? "null" : String(v)}` : `not (t.${ident(c)} ${{ eq: "=", neq: "<>", gt: ">", lt: "<" }[o]} ${lit(v)})`); return q; },
    order(c, o = {}) { orders.push(`t.${ident(c)} ${o.ascending === false ? "desc" : "asc"}`); return q; },
    limit(n) { range = [0, n - 1]; return q; },
    range(a, b) { range = [a, b]; return q; },
    single() { single = "one"; return q; },
    maybeSingle() { single = "maybe"; return q; },
    then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  function run() {
    try {
      const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
      let body;
      if (op === "select") {
        const page = range ? ` limit ${range[1] - range[0] + 1} offset ${range[0]}` : "";
        body = `select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (select ${selectList(table, cols)} from public.${ident(table)} t${where()}${orders.length ? ` order by ${orders.join(", ")}` : ""}${page}) q`;
      } else {
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const ret = returning ? ` returning ${selectList(table, returning).replace(/\bt\./g, "")}` : " returning 1 as ok";
        let stmt;
        if (op === "insert" || op === "upsert") {
          const values = rows.map((r) => `(${keys.map((k) => (k in r ? lit(r[k]) : "default")).join(", ")})`).join(", ");
          const target = (onConflict ? onConflict.split(",").map((c) => c.trim()) : meta(table).pk);
          const tail = op === "upsert" ? (ignoreDuplicates ? " on conflict do nothing" : ` on conflict (${target.map(ident).join(", ")}) do update set ${keys.filter((k) => !target.includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ") || `${ident(target[0])} = excluded.${ident(target[0])}`}`) : "";
          stmt = rows.length ? `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values ${values}${tail}${ret}` : null;
        } else if (op === "update") {
          stmt = `update public.${ident(table)} t set ${Object.entries(payload).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(", ")}${where()}${ret}`;
        } else stmt = `delete from public.${ident(table)} t${where()}${ret}`;
        body = stmt ? `with w as (${stmt}) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from w` : "select '[]'::jsonb";
      }
      let data = runAs(identity, body);
      if (op !== "select" && !returning) data = null;
      if (single) {
        if (data.length !== 1 && !(single === "maybe" && data.length === 0)) return { data: null, error: Object.assign(new Error("JSON object requested, multiple (or no) rows returned"), { code: "PGRST116" }) };
        data = data[0] ?? null;
      }
      return { data, error: null };
    } catch (e) { return { data: null, error: toError(e) }; }
  }
  return q;
}

/* ---------------------------------------------------------- the client */
export const as = (identity) => ({ rpc: async (name, args) => rpc(identity, name, args), from: (table) => from(identity, table), identity });
export const anon = () => as("anon");

// Fixtures only. Never what a test asserts through.
export const superuser = {
  sql: (sql) => psql(sql),
  rows: (sql) => JSON.parse(psql(`select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (${sql}) q`)),
  one: (sql) => psql(sql),
};

// A player, made the way the app does it: the public sign-up function, as anon.
let counter = 0;
export function newTag() { return `it${Date.now().toString(36).slice(-5)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 14); }

export async function signUp(username) {
  const { error } = await anon().rpc("register_player", { p_username: username, p_password: "secret1" });
  if (error) throw error;
  const id = superuser.one(`select id from public.profiles where username = '${esc(username)}'`);
  return { id, username, client: as(id) };
}

// The first admin cannot be made through the app (that is the point), so a fixture promotes it.
export function promote(player) {
  superuser.sql(`update public.profiles set role = 'admin' where id = '${player.id}'`);
  return player;
}

// Befriend two players through the real friend functions.
export async function befriend(a, b) {
  const r1 = await a.client.rpc("friend_request", { p_username: b.username });
  if (r1.error) throw r1.error;
  const r2 = await b.client.rpc("friend_respond", { p_user: a.id, p_accept: true });
  if (r2.error) throw r2.error;
}

// Removes what a test run made. Everything it creates carries the tag.
export function cleanup(tag, extraSql = "") {
  const like = `${esc(tag)}%`;
  // Views first (their contents do not cascade), then the accounts, whose library, progress and shares go with them.
  superuser.sql(`begin;
    ${extraSql}
    create temp table tagged on commit drop as select id from public.profiles where username like '${like}';
    create temp table tagged_views on commit drop as
      select id from public.collections where owner_id in (select id from tagged) or (owner_id is null and name ilike '${like}');
    create temp table tagged_rules on commit drop as select id from public.grammar_rules where legacy_key ilike '${like}';
    create temp table tagged_senses on commit drop as select id from public.senses where legacy_key ilike '${like}';
    set local session_replication_role = replica;      -- these rows only point at each other, and all of them are the test's
    delete from public.catalog_takes where entry_id in (select id from public.catalog_entries where collection_id in (select id from tagged_views)) or user_id in (select id from tagged);
    delete from public.view_link_takes where token in (select token from public.view_links where collection_id in (select id from tagged_views)) or user_id in (select id from tagged);
    delete from public.view_links where collection_id in (select id from tagged_views);
    delete from public.catalog_entries where collection_id in (select id from tagged_views);
    delete from public.collection_shares where collection_id in (select id from tagged_views) or copy_id in (select id from tagged_views) or from_user in (select id from tagged) or to_user in (select id from tagged);
    delete from public.collection_senses where collection_id in (select id from tagged_views) or sense_id in (select id from tagged_senses);
    delete from public.collection_rules where collection_id in (select id from tagged_views) or rule_id in (select id from tagged_rules);
    delete from public.grammar_questions where rule_id in (select id from tagged_rules);
    delete from public.library_rules where rule_id in (select id from tagged_rules);
    delete from public.rule_progress where rule_id in (select id from tagged_rules);
    delete from public.collections where id in (select id from tagged_views);
    delete from public.sense_links where from_sense in (select id from tagged_senses) or to_sense in (select id from tagged_senses);
    delete from public.library_entries where sense_id in (select id from tagged_senses);
    delete from public.sense_progress where sense_id in (select id from tagged_senses);
    delete from public.item_key_aliases where from_key ilike '${like}' or to_key ilike '${like}';
    set local session_replication_role = origin;
    delete from auth.users where email like '${like}@wordhunter.test';
    delete from public.senses where legacy_key ilike '${like}';
    delete from public.content_items where key ilike '${like}';
    delete from public.grammar_rules where legacy_key ilike '${like}';
    delete from public.headwords h where lower(h.text) like lower('%${like}') and not exists (select 1 from public.senses s where s.headword_id = h.id);
    commit;
  `);
}
