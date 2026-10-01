import { json, PLAYER_DAILY_AI_CALLS, serverAuth, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.js";

// Asks the database gate with the caller's own token. PostgREST verifies
// the token, so a forged or expired one never reaches Gemini. The gate
// also logs the call (Admin -> AI usage): task names the feature, preview
// is a short look at what was asked, chars the size of the request.
// Returns { callId } when allowed, or { denied: Response } to send back.
export async function gate(request, { adminOnly = false, kind = "ai", task = "", preview = "", chars = null } = {}) {
  const deny = (status, body) => ({ denied: json(status, body) });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return deny(500, { error: "Server is missing Supabase settings." });
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return deny(401, { error: "Sign in to use AI features." });
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_gate`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({
        p_admin_only: adminOnly, p_daily_limit: PLAYER_DAILY_AI_CALLS, p_kind: kind,
        p_task: String(task || "").slice(0, 80) || null, p_preview: String(preview || "").slice(0, 300) || null, p_chars: Number.isFinite(chars) ? chars : null,
      }),
    });
  } catch (e) {
    return deny(502, { error: "Couldn't reach the account service. Try again." });
  }
  if (res.status === 401 || res.status === 403) return deny(401, { error: "Your session expired. Sign in again." });
  if (!res.ok) return deny(502, { error: `Account check failed (${res.status}).` });
  const verdict = await res.json();
  if (verdict.ok) return { callId: verdict.call ?? null };
  if (verdict.reason === "admin") return deny(403, { error: "Only the admin can use this AI tool." });
  if (verdict.reason === "quota") return deny(429, { error: `Daily AI limit reached (${verdict.limit ?? PLAYER_DAILY_AI_CALLS}). It resets tomorrow.` });
  if (verdict.reason === "off") return deny(403, { error: kind === "tts" ? "AI pronunciation is turned off right now." : "The admin has turned AI off for players right now." });
  return deny(401, { error: "Sign in to use AI features." });
}

// Records how an allowed call went, with the server's key: players can't
// finish (or rewrite) their own log rows. Never fails the request: the log
// is best effort, and waits at most 1.5 s.
export async function finishCall(callId, { ok, model = null, ms = null, status = null, error = null, outputChars = null, usage = null } = {}) {
  const auth = serverAuth();
  if (!callId || !SUPABASE_URL || !auth) return;
  const send = fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_call_finish`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      p_id: callId, p_ok: !!ok, p_model: model, p_ms: Number.isFinite(ms) ? Math.round(ms) : null, p_http_status: status,
      p_error: error ? String(error).slice(0, 300) : null, p_output_chars: outputChars, p_input_tokens: usage?.inputTokens ?? null, p_output_tokens: usage?.outputTokens ?? null,
    }),
  }).catch(() => null);
  await Promise.race([send, new Promise((r) => setTimeout(r, 1500))]);
}

// What the log shows of a request: the INPUT JSON part of an AI prompt
// (the word, the answer…), not the long instructions.
export function previewOf(prompt) {
  const s = String(prompt || "");
  const at = s.lastIndexOf("INPUT JSON:\n");
  const req = s.lastIndexOf("Requests:\n");
  const tail = at >= 0 ? s.slice(at + 12) : req >= 0 ? s.slice(req + 10) : s;
  return tail.replace(/\s+/g, " ").trim().slice(0, 300);
}
