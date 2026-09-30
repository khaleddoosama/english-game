import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TTS_MODEL, GEMINI_TTS_VOICE } from "./env.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function generate(model, body) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error("GEMINI_API_KEY is not set on the server."), { status: 500 });
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Gemini request failed (${res.status})`), { status: res.status === 429 ? 429 : 502 });
  return data;
}

// Text in, JSON text out. Low thinking keeps these short grading and
// writing tasks fast; the output limit is left to the model because
// thinking tokens count toward it.
export async function generateJsonText(prompt) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.7, thinkingConfig: { thinkingLevel: "low" } },
  };
  let data;
  try { data = await generate(GEMINI_MODEL, body); } catch (e) {
    // A model without thinking levels (set via GEMINI_MODEL) rejects the field; retry plain.
    if (!/thinking/i.test(e.message)) throw e;
    delete body.generationConfig.thinkingConfig;
    data = await generate(GEMINI_MODEL, body);
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  if (!text) throw Object.assign(new Error(`Gemini returned no text (${data?.candidates?.[0]?.finishReason || "no candidate"}).`), { status: 502 });
  return text;
}

// Speech: Gemini returns raw 16-bit PCM; wrap it in a WAV header so any
// browser <audio> can play it.
export async function speak(text) {
  const data = await generate(GEMINI_TTS_MODEL, {
    contents: [{ role: "user", parts: [{ text: `Say clearly, in a neutral American accent: ${text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } } },
  });
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw Object.assign(new Error("Gemini returned no audio."), { status: 502 });
  const pcm = Buffer.from(part.inlineData.data, "base64");
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
