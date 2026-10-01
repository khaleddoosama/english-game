// Browser side of the AI and speech endpoints. The Gemini key lives on the
// server; requests carry the player's Supabase token.
import { accessToken } from "./auth";
import { isLocalMode } from "./supabase";

async function post(path, body) {
  if (isLocalMode) throw new Error("AI features need the online version. Sign in on the deployed site.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You're offline. AI features need a connection.");
  const token = await accessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("audio/")) return { audio: await res.blob() };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function callAiText(prompt, { adminOnly = false, task = "" } = {}) {
  const { text } = await post("/api/ai", { prompt, adminOnly, task });
  return text;
}

// Phrase -> audio URL. Remembered per device so a repeat play never
// touches the server; the server remembers across players.
const TTS_CACHE_KEY = "wh-tts-urls";
const ttsMemory = new Map();
function ttsStore() {
  try { return JSON.parse(localStorage.getItem(TTS_CACHE_KEY) || "{}"); } catch { return {}; }
}
export async function speechUrl(text) {
  const key = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!key) throw new Error("Nothing to say.");
  if (ttsMemory.has(key)) return ttsMemory.get(key);
  const stored = ttsStore()[key];
  if (stored) { ttsMemory.set(key, stored); return stored; }
  const out = await post("/api/tts", { text });
  const url = out.url || (out.audio ? URL.createObjectURL(out.audio) : null);
  if (!url) throw new Error("No audio came back.");
  ttsMemory.set(key, url);
  if (out.url) {
    try {
      const all = ttsStore(); all[key] = out.url;
      const keys = Object.keys(all);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete all[k];
      localStorage.setItem(TTS_CACHE_KEY, JSON.stringify(all));
    } catch (_) {}
  }
  return url;
}
