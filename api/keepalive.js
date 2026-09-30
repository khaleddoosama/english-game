// Daily Vercel Cron: one tiny query so the free Supabase project never
// pauses for inactivity.
import { json, SUPABASE_ANON_KEY, SUPABASE_URL } from "./_lib/env.js";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, { error: "unauthorized" });
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY } }).catch((e) => ({ ok: false, status: String(e) }));
  const rest = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SUPABASE_ANON_KEY } }).catch((e) => ({ ok: false, status: String(e) }));
  return json(res.ok && rest.ok ? 200 : 502, { auth: res.status, rest: rest.status, at: new Date().toISOString() });
}
