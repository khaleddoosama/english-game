// Server-side settings. The Supabase URL and anon key are public values
// (the browser has them too); GEMINI_API_KEY and the Supabase secret key
// are not.
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
// Supabase -> Settings -> API Keys -> Secret key. Only the server writes the
// shared pronunciation cache and finishes AI log rows, with this key.
// Without it, audio still plays (just not cached) and log rows stay
// "unfinished". Read on use, so a redeploy with the key needs no code change.
const secretKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const serverAuth = () => { const key = secretKey(); return key ? { apikey: key, authorization: `Bearer ${key}` } : null; };
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts";
export const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";
// Tried in order when the main model is overloaded, rate-limited or gone.
const list = (v, d) => (v ?? d).split(",").map((x) => x.trim()).filter(Boolean);
export const GEMINI_FALLBACK_MODELS = list(process.env.GEMINI_FALLBACK_MODELS, "gemini-3.5-flash-lite,gemini-flash-lite-latest");
export const GEMINI_TTS_FALLBACK_MODELS = list(process.env.GEMINI_TTS_FALLBACK_MODELS, "gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview");
export const PLAYER_DAILY_AI_CALLS = Number(process.env.PLAYER_DAILY_AI_CALLS || 150);

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
