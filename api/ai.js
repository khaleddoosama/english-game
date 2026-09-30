// POST /api/ai  { prompt, adminOnly? }  ->  { text }
// The Gemini key never leaves the server; the gate checks the account,
// admin-only tools and the player's daily quota first.
import { gate } from "./_lib/gate.js";
import { json } from "./_lib/env.js";
import { generateJsonText } from "./_lib/gemini.js";

const MAX_PROMPT = 120000;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json(400, { error: "Empty prompt." });
  if (prompt.length > MAX_PROMPT) return json(413, { error: "This request is too large for one AI call." });
  const denied = await gate(request, { adminOnly: !!body.adminOnly });
  if (denied) return denied;
  try {
    return json(200, { text: await generateJsonText(prompt) });
  } catch (e) {
    console.error("ai:", e.message);
    return json(e.status || 502, { error: e.message || "AI request failed." });
  }
}
