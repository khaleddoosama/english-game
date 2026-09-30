// POST /api/image-import  { url }  ->  { url }   (admin only)
// Copies an outside picture into the word-images bucket so a word never
// depends on someone else's server staying up or allowing hotlinks.
import { createHash } from "node:crypto";
import { gate } from "./_lib/gate.js";
import { json, SUPABASE_ANON_KEY, SUPABASE_URL } from "./_lib/env.js";

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const source = String(body?.url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(source)) return json(400, { error: "The link must start with http:// or https://" });
  const denied = await gate(request, { adminOnly: true });
  if (denied) return denied;
  let res;
  try {
    res = await fetch(source, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "user-agent": "WordHunter-ImageImport/1.0", accept: "image/*" } });
  } catch (e) {
    return json(502, { error: "Couldn't download that picture (timed out or blocked)." });
  }
  if (!res.ok) return json(502, { error: `That link answered ${res.status}.` });
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return json(415, { error: "That link isn't a PNG, JPG, WebP or GIF picture." });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { error: "That picture is over 2 MB. Download it and use Add picture instead (it gets resized)." });
  const path = `links/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/word-images/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, authorization: request.headers.get("authorization"), "content-type": type, "cache-control": "max-age=31536000", "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) return json(502, { error: `Storing the picture failed (${up.status}).` });
  return json(200, { url: `${SUPABASE_URL}/storage/v1/object/public/word-images/${path}` });
}
