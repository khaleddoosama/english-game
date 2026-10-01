import { GEMINI_API_KEY, GEMINI_FALLBACK_MODELS, GEMINI_MODEL, GEMINI_TTS_FALLBACK_MODELS, GEMINI_TTS_MODEL, GEMINI_TTS_VOICE } from "./env.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini answers 503 "high demand / overloaded" (and sometimes 500/504)
// during load spikes; 429 means this model's rate limit or quota is spent.
const TRANSIENT = new Set([500, 502, 503, 504]);
const ATTEMPTS_PER_MODEL = 2;
const BUDGET_MS = 40000; // stay well inside the function's 60 s limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(model, body) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error("GEMINI_API_KEY is not set on the server."), { status: 500, final: true });
  let res;
  try {
    res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(new Error(`Couldn't reach Gemini (${e.message}).`), { upstream: 503 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Gemini request failed (${res.status})`), { upstream: res.status });
  return data;
}

// Try the main model, then the fallbacks. A busy model gets one quick
// retry; a rate-limited or missing model is skipped straight away.
// buildBody(model, plain) lets text calls drop thinkingConfig for models
// that don't support it.
export async function generateWithFallback(models, buildBody, { log = console } = {}) {
  const started = Date.now();
  const chain = [...new Set(models.filter(Boolean))];
  let lastError = null, sawBusy = false;
  for (const model of chain) {
    let plain = false;
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        const data = await generate(model, buildBody(model, plain));
        if (model !== chain[0]) log.warn?.(`gemini: answered by fallback ${model}`);
        return { data, model };
      } catch (e) {
        if (e.final) throw e;
        lastError = e;
        const s = e.upstream;
        if (s === 400 && !plain && /thinking/i.test(e.message)) { plain = true; attempt--; continue; }
        if (TRANSIENT.has(s)) { sawBusy = true; log.warn?.(`gemini: ${model} busy (${s}), attempt ${attempt + 1}`); if (attempt + 1 < ATTEMPTS_PER_MODEL) await sleep(600 * 2 ** attempt + Math.random() * 400); continue; }
        if (s === 429) { sawBusy = true; log.warn?.(`gemini: ${model} rate-limited`); break; }
        if (s === 404) { log.warn?.(`gemini: model ${model} not found, skipping`); break; }
        throw Object.assign(e, { status: 502 }); // a real request problem: don't hide it
      }
    }
  }
  if (sawBusy) throw Object.assign(new Error("The AI is very busy right now (Google's servers are overloaded). Please try again in a minute."), { status: 503 });
  throw Object.assign(lastError || new Error("AI request failed."), { status: 502 });
}

// Text in, JSON text out. Low thinking keeps these short grading and
// writing tasks fast; the output limit is left to the model because
// thinking tokens count toward it.
export async function generateJsonText(prompt) {
  const { data, model } = await generateWithFallback([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS], (_model, plain) => ({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.7, ...(plain ? {} : { thinkingConfig: { thinkingLevel: "low" } }) },
  }));
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  if (!text) throw Object.assign(new Error(`Gemini returned no text (${data?.candidates?.[0]?.finishReason || "no candidate"}).`), { status: 502, model });
  return { text, model, usage: usageOf(data) };
}
// Token counts for the AI call log (thinking counts as output).
export function usageOf(data) {
  const u = data?.usageMetadata || {};
  const out = (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
  return { inputTokens: Number(u.promptTokenCount) || null, outputTokens: out || null };
}

// Speech: Gemini returns raw 16-bit PCM; wrap it in a WAV header so any
// browser <audio> can play it.
export async function speak(text, info = {}) {
  const { data, model } = await generateWithFallback([GEMINI_TTS_MODEL, ...GEMINI_TTS_FALLBACK_MODELS], () => ({
    contents: [{ role: "user", parts: [{ text: `Say clearly, in a neutral American accent: ${text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } } },
  }));
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw Object.assign(new Error("Gemini returned no audio."), { status: 502 });
  const pcm = Buffer.from(part.inlineData.data, "base64");
  info.model = model; info.usage = usageOf(data);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1]) || 24000;
  return wav(pcm, rate);
}

export function wav(pcm, rate, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * bits / 8, 28); header.writeUInt16LE(channels * bits / 8, 32); header.writeUInt16LE(bits, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
