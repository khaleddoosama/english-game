// POST /api/ai  { prompt, task }  ->  { text }
// The Gemini key never leaves the server. The task names the feature: the
// server knows which ones are admin-only and how big each prompt may be
// (_lib/tasks.js); the gate then checks the account and the daily quota.
import { finishCall, gate, previewOf } from "./_lib/gate.js";
import { json } from "./_lib/env.js";
import { generateJsonText } from "./_lib/gemini.js";
import { aiTask } from "./_lib/tasks.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json(400, { error: "Empty prompt." });
  const task = aiTask(body.task);
  if (!task) return json(400, { error: "Unknown AI feature. Reload the page to get the latest version." });
  if (prompt.length > task.maxChars) return json(413, { error: "This request is too large for one AI call." });
  const { denied, callId } = await gate(request, { adminOnly: task.adminOnly, task: task.name, preview: previewOf(prompt), chars: prompt.length });
  if (denied) return denied;
  const started = Date.now();
  try {
    const { text, model, usage } = await generateJsonText(prompt, { signal: request.signal });
    await finishCall(callId, { ok: true, model, ms: Date.now() - started, status: 200, outputChars: text.length, usage });
    return json(200, { text, model });
  } catch (e) {
    console.error("ai:", e.message);
    const status = e.status || 502;
    await finishCall(callId, { ok: false, model: e.model || null, ms: Date.now() - started, status, error: e.message });
    return json(status, { error: e.message || "AI request failed." });
  }
}
