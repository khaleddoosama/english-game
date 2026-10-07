// Browser side of the AI and speech endpoints. The Gemini key lives on the
// server; requests carry the player's Supabase token.
import { accessToken } from "./auth";
import { isLocalMode } from "./supabase";
import { withRequestTimeout } from "./requestTimeout.js";

export const AI_REQUEST_TIMEOUT_MS = 45000;

async function post(path, body) {
  if (isLocalMode) throw new Error("AI features need the online version. Sign in on the deployed site.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You're offline. AI features need a connection.");
  return withRequestTimeout(async (signal) => {
    const token = await accessToken();
    if (signal.aborted) throw new Error("AI request timed out. Please try again.");
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    const type = res.headers.get("content-type") || "";
    if (type.startsWith("audio/")) return { audio: await res.blob() };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, AI_REQUEST_TIMEOUT_MS, "AI took too long to respond. Please try again.");
}

export async function callAiText(prompt, { adminOnly = false, task = "" } = {}) {
  const { text } = await post("/api/ai", { prompt, adminOnly, task });
  if (typeof text !== "string" || !text.trim()) throw new Error("AI returned no usable response. Please try again.");
  return text;
}

// Phrase -> audio URL. Remembered per device so a repeat play never
// touches the server; the server remembers across players.
const TTS_CACHE_KEY = "wh-tts-urls-v2"; // v1 links point to files with the old instruction spoken aloud
const ttsMemory = new Map();
function ttsStore() {
  try { return JSON.parse(localStorage.getItem(TTS_CACHE_KEY) || "{}"); } catch { return {}; }
}
const speechKey = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
export async function speechUrl(text) {
  const key = speechKey(text);
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
// A remembered link that doesn't play (an older server could hand out a
// link to a file it never stored): forget it, so the next try asks again.
export function forgetSpeechUrl(text) {
  const key = speechKey(text);
  ttsMemory.delete(key);
  try { const all = ttsStore(); if (key in all) { delete all[key]; localStorage.setItem(TTS_CACHE_KEY, JSON.stringify(all)); } } catch (_) {}
}
