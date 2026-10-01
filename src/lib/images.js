// Word pictures live in the public `word-images` bucket: resized on the
// device to WebP, named by content hash (the same picture is stored once),
// and cached by browsers and the CDN for a year.
import { accessToken } from "./auth";
import { isLocalMode, supabase } from "./supabase";

const BUCKET = "word-images";
const MAX_SIDE = 512;
const STORAGE_PREFIX = supabase ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/` : null;

// Our own storage URLs always load, so they count as working pictures
// without the background load check outside links need.
export const isStoredImage = (url) => !!STORAGE_PREFIX && typeof url === "string" && url.startsWith(STORAGE_PREFIX);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture the browser can open.")); };
    img.src = url;
  });
}

async function toWebp(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error("Choose a PNG, JPG, WebP or GIF picture.");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (blob && blob.type === "image/webp") return { blob, ext: "webp" };
  // Browsers without WebP encoding fall back to JPEG.
  return { blob: await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85)), ext: "jpg" };
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// File from the device -> public URL. Local mode keeps a small data URL.
export async function uploadWordImage(file) {
  const { blob, ext } = await toWebp(file);
  if (isLocalMode) return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  const path = `words/${await sha256Hex(blob)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { cacheControl: "31536000", contentType: blob.type, upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// A picture carried inside the content itself (a data: URI from an import
// or from local mode) instead of a link: sent to every player with every
// content load, so it belongs in the bucket.
const EMBEDDED = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
export const isEmbeddedImage = (value) => typeof value === "string" && EMBEDDED.test(value);

export function dataUrlToBlob(url) {
  const comma = url.indexOf(",");
  const type = /^data:([^;,]+)/i.exec(url)[1].toLowerCase();
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Embedded pictures -> Map(data URI -> stored URL), one upload per distinct
// picture. One that can't be stored now stays as it is (tried again later).
export async function storeEmbeddedImages(values, upload = uploadWordImage) {
  const stored = new Map();
  for (const value of new Set(values.filter(isEmbeddedImage))) {
    try { stored.set(value, await upload(dataUrlToBlob(value))); }
    catch (e) { console.error("Couldn't move a picture into storage:", e); }
  }
  return stored;
}

// Outside picture link -> a copy in our storage, so it can't break or be blocked later.
export async function importImageLink(url) {
  if (isLocalMode) throw new Error("Copying links needs the online version.");
  const token = await accessToken();
  const res = await fetch("/api/image-import", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Copy failed (${res.status})`);
  return data.url;
}

// Warm the cache for a picture that is about to be shown.
export function preloadImage(url) {
  if (typeof Image === "undefined" || typeof url !== "string" || !/^https?:/.test(url)) return;
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = url;
}
