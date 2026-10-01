import { json, PLAYER_DAILY_AI_CALLS, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.js";

// Asks the database gate with the caller's own token. PostgREST verifies
// the token, so a forged or expired one never reaches Gemini.
// Returns null when allowed, or the error Response to send back.
export async function gate(request, { adminOnly = false, kind = "ai" } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { error: "Server is missing Supabase settings." });
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return json(401, { error: "Sign in to use AI features." });
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_gate`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ p_admin_only: adminOnly, p_daily_limit: PLAYER_DAILY_AI_CALLS, p_kind: kind }),
    });
  } catch (e) {
    return json(502, { error: "Couldn't reach the account service. Try again." });
  }
  if (res.status === 401 || res.status === 403) return json(401, { error: "Your session expired. Sign in again." });
  if (!res.ok) return json(502, { error: `Account check failed (${res.status}).` });
  const verdict = await res.json();
  if (verdict.ok) return null;
  if (verdict.reason === "admin") return json(403, { error: "Only the admin can use this AI tool." });
  if (verdict.reason === "quota") return json(429, { error: `Daily AI limit reached (${verdict.limit ?? PLAYER_DAILY_AI_CALLS}). It resets tomorrow.` });
  if (verdict.reason === "off") return json(403, { error: kind === "tts" ? "AI pronunciation is turned off right now." : "The admin has turned AI off for players right now." });
  return json(401, { error: "Sign in to use AI features." });
}
