// POST /api/ai  { prompt, adminOnly? }  ->  { text }
// The Gemini key never leaves the server; the gate checks the account,
// admin-only tools and the player's daily quota first.
import { finishCall, gate, previewOf } from "./_lib/gate.js";
import { json } from "./_lib/env.js";
import { generateJsonText } from "./_lib/gemini.js";

const MAX_PROMPT = 120000;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json(400, { error: "Empty prompt." });
  if (prompt.length > MAX_PROMPT) return json(413, { error: "This request is too large for one AI call." });
  const task = typeof body.task === "string" ? body.task : "";
  const { denied, callId } = await gate(request, { adminOnly: !!body.adminOnly, task, preview: previewOf(prompt), chars: prompt.length });
  if (denied) return denied;
  const started = Date.now();
  try {
    const { text, model, usage } = await generateJsonText(prompt);
    await finishCall(request, callId, { ok: true, model, ms: Date.now() - started, status: 200, outputChars: text.length, usage });
    return json(200, { text, model });
  } catch (e) {
    console.error("ai:", e.message);
    const status = e.status || 502;
    await finishCall(request, callId, { ok: false, model: e.model || null, ms: Date.now() - started, status, error: e.message });
    return json(status, { error: e.message || "AI request failed." });
  }
}
