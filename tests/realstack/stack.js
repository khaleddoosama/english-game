// A real Supabase stack as the test's backend: GoTrue (sign-in, JWTs), PostgREST (named-argument RPC, error codes,
// status codes, role switching from the JWT), PostgreSQL 15 with Supabase's own roles and auth schema, and the
// supabase-js client the app uses. NOT part of it: Realtime, Storage, Studio, the app's Vercel functions.
// Needs REALSTACK_URL, REALSTACK_PGURL (a superuser URL, used only for fixtures) and REALSTACK_JWT_SECRET. See docs/integration-tests.md.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export const URL_ = process.env.REALSTACK_URL;
export const PGURL = process.env.REALSTACK_PGURL;
const SECRET = process.env.REALSTACK_JWT_SECRET;
export const ENABLED = !!(URL_ && PGURL && SECRET);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const anonKey = () => { const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "anon", iss: "supabase-demo", exp: Math.floor(Date.now() / 1000) + 86400 })}`; return `${h}.${createHmac("sha256", SECRET).update(h).digest("base64url")}`; };

export const sql = (text) => execFileSync("psql", [PGURL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8" }).trim();
export const rows = (text) => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (${text}) q`));

// supabase-js with no session: what a visitor has (the publishable key only).
export const visitor = () => createClient(URL_, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });

let counter = 0;
export const newTag = () => `rs${Date.now().toString(36).slice(-5)}${(counter++).toString(36)}`.slice(0, 12);
export const emailFor = (username) => `${username}@wordhunter.test`;

// The app's own way: register_player (as the visitor), then sign in through GoTrue with the placeholder e-mail.
export async function signUp(username) {
  const v = visitor();
  const reg = await v.rpc("register_player", { p_username: username, p_password: "secret1" });
  if (reg.error) throw new Error(`register_player: ${reg.error.message}`);
  const client = createClient(URL_, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: emailFor(username), password: "secret1" });
  if (error) throw new Error(`signInWithPassword: ${error.message}`);
  return { id: data.user.id, username, client };
}
export const promote = (player) => sql(`update public.profiles set role = 'admin' where id = '${player.id}'`);
// A friendship, made the way the app makes it (request, then accept).
export async function befriend(a, b) {
  const r = await a.client.rpc("friend_request", { p_username: b.username });
  if (r.error) throw new Error(`friend_request: ${r.error.message}`);
  const s = await b.client.rpc("friend_respond", { p_user: a.id, p_accept: true });
  if (s.error) throw new Error(`friend_respond: ${s.error.message}`);
}
export const cleanup = (tag) => sql(`delete from auth.users where email like '${tag}%@wordhunter.test'`);
