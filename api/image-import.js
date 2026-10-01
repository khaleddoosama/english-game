// POST /api/image-import  { url }  ->  { url }   (admin only)
// Copies an outside picture into the word-images bucket so a word never
// depends on someone else's server staying up or allowing hotlinks. Only
// public internet addresses are fetched, at most 2 MB, and the bytes must
// really be the picture type the link says (_lib/publicFetch.js).
import { createHash } from "node:crypto";
import { finishCall, gate } from "./_lib/gate.js";
import { json, SUPABASE_ANON_KEY, SUPABASE_URL } from "./_lib/env.js";
import { fetchPublic } from "./_lib/publicFetch.js";

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 2 * 1024 * 1024;

// The first bytes of each picture type.
export function looksLike(type, bytes) {
  const ascii = (from, to) => bytes.subarray(from, to).toString("latin1");
  if (type === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG";
  if (type === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/gif") return ascii(0, 4) === "GIF8";
  if (type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  return false;
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const source = String(body?.url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(source)) return json(400, { error: "The link must start with http:// or https://" });
  const { denied, callId } = await gate(request, { adminOnly: true, task: "Copy a picture link", preview: source, chars: source.length });
  if (denied) return denied;
  // Every way out is recorded in Admin -> AI usage, with the reason.
  const started = Date.now();
  const fail = async (status, error) => { await finishCall(callId, { ok: false, ms: Date.now() - started, status, error }); return json(status, { error }); };
  let got;
  try {
    got = await fetchPublic(source, { maxBytes: MAX_BYTES, headers: { "user-agent": "WordHunter-ImageImport/1.0", accept: "image/*" } });
  } catch (e) {
    if (e.status === 413) return fail(413, "That picture is over 2 MB. Download it and use Add picture instead (it gets resized).");
    return fail(e.status || 502, e.status ? e.message : "Couldn't download that picture (timed out or blocked).");
  }
  const ext = TYPES[got.type];
  if (!ext || !looksLike(got.type, got.body)) return fail(415, "That link isn't a PNG, JPG, WebP or GIF picture.");
  // Named by its content: the same picture twice is the same file.
  const path = `links/${createHash("sha256").update(got.body).digest("hex").slice(0, 32)}.${ext}`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/word-images/${path}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/word-images/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, authorization: request.headers.get("authorization"), "content-type": got.type, "cache-control": "max-age=31536000", "x-upsert": "false" },
    body: got.body,
  }).catch(() => null);
  if (!up?.ok) {
    const reply = up ? await up.text().catch(() => "") : "";
    const duplicate = up && (up.status === 409 || /duplicate|already exists/i.test(reply));
    const there = duplicate && (await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false));
    if (!there) return fail(502, `Storing the picture failed (${up ? up.status : "no answer"}).`);
  }
  await finishCall(callId, { ok: true, ms: Date.now() - started, status: 200, outputChars: got.body.length });
  return json(200, { url: publicUrl });
}
