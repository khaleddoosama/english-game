// POST /api/tts  { text }  ->  { url }, or the audio itself
// Each phrase is spoken by Gemini once, stored in the public `tts` bucket by
// the server (players can't write there), and served from Supabase's CDN
// from then on. A phrase already cached plays even while AI pronunciation
// is turned off: turning it off stops new (paid) audio, not cached audio.
import { createHash } from "node:crypto";
import { finishCall, gate } from "./_lib/gate.js";
import { GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, json, serverAuth, SUPABASE_URL } from "./_lib/env.js";
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
  if (await exists(publicUrl)) return json(200, { url: publicUrl, cached: true });
  const { denied, callId } = await gate(request, { kind: "tts", task: "Pronunciation", preview: text, chars: text.length });
  if (denied) return denied;
  let audio;
  const info = {}, started = Date.now();
  try { audio = await speak(text, info); } catch (e) {
    console.error("tts:", e.message);
    await finishCall(callId, { ok: false, ms: Date.now() - started, status: e.status || 502, error: e.message });
    return json(e.status || 502, { error: e.message || "Speech failed." });
  }
  const stored = await store(path, audio, publicUrl);
  await finishCall(callId, { ok: true, model: info.model, ms: Date.now() - started, status: 200, outputChars: audio.length, usage: info.usage });
  // A link only when the file is really there; otherwise the audio itself.
  if (stored) return json(200, { url: publicUrl, cached: false });
  return new Response(audio, { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
}

const exists = (url) => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false);

// Puts the audio in the shared cache. True when the file is there
// afterwards: written now, or by another request that got there first.
async function store(path, audio, publicUrl) {
  const auth = serverAuth();
  if (!auth) return false;
  let up;
  try {
    up = await fetch(`${SUPABASE_URL}/storage/v1/object/tts/${path}`, {
      method: "POST",
      headers: { ...auth, "content-type": "audio/wav", "cache-control": "max-age=31536000", "x-upsert": "false" },
      body: audio,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("tts upload:", e.message);
    return false;
  }
  if (up.ok) return true;
  const reply = await up.text().catch(() => "");
  // Storage answers a duplicate with 409, or 400 and "Duplicate" in the body.
  if (up.status === 409 || /duplicate|already exists/i.test(reply)) return exists(publicUrl);
  console.error("tts upload:", up.status, reply.slice(0, 200));
  return false;
}
