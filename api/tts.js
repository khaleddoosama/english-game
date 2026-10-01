// POST /api/tts  { text }  ->  { url }
// Each phrase is spoken by Gemini once, stored in the public `tts` bucket,
// and served from Supabase's CDN from then on.
import { createHash } from "node:crypto";
import { gate } from "./_lib/gate.js";
import { GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, json, SUPABASE_ANON_KEY, SUPABASE_URL } from "./_lib/env.js";
import { speak } from "./_lib/gemini.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const text = String(body?.text || "").replace(/\s+/g, " ").trim();
  if (!text) return json(400, { error: "Nothing to say." });
  if (text.length > 400) return json(413, { error: "That's too long to read aloud." });
  const hash = createHash("sha256").update(`${GEMINI_TTS_MODEL}|${GEMINI_TTS_VOICE}|${text.toLowerCase()}`).digest("hex").slice(0, 40);
  const path = `v1/${hash}.wav`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/tts/${path}`;
  const cached = await fetch(publicUrl, { method: "HEAD" }).catch(() => null);
  if (cached?.ok) return json(200, { url: publicUrl, cached: true });
  const denied = await gate(request, { kind: "tts" });
  if (denied) return denied;
  let audio;
  try { audio = await speak(text); } catch (e) {
    console.error("tts:", e.message);
    return json(e.status || 502, { error: e.message || "Speech failed." });
  }
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tts/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY, authorization: request.headers.get("authorization"),
      "content-type": "audio/wav", "cache-control": "max-age=31536000", "x-upsert": "false",
    },
    body: audio,
  });
  // 409/400 "already exists" means another player cached it first — fine.
  if (!up.ok && up.status !== 409 && up.status !== 400) {
    console.error("tts upload:", up.status, await up.text().catch(() => ""));
    return new Response(audio, { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  }
  return json(200, { url: publicUrl, cached: false });
}
