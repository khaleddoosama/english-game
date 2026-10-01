// The AI call log from the server's side: /api/ai asks the gate with the
// feature name and a short preview, then records how the call went
// (model, time, tokens) or why it failed. Refused calls never reach
// Gemini. Logging trouble never breaks the answer.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let ai, gate, gemini;
beforeAll(async () => {
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.GEMINI_API_KEY = "key";
  process.env.GEMINI_MODEL = "main-model";
  process.env.GEMINI_FALLBACK_MODELS = "";
  ai = await import("../api/ai.js");
  gate = await import("../api/_lib/gate.js");
  gemini = await import("../api/_lib/gemini.js");
});
afterEach(() => { vi.unstubAllGlobals(); });

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const GEMINI_OK = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 320, candidatesTokenCount: 40, thoughtsTokenCount: 12 } };

// A fake network: the database gate, the finish call and Gemini.
function network({ verdict = { ok: true, call: 77 }, gemini = [reply(200, GEMINI_OK)] } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (url.endsWith("/rpc/ai_gate")) { calls.push({ to: "gate", body }); return reply(200, verdict); }
    if (url.endsWith("/rpc/ai_call_finish")) { calls.push({ to: "finish", body }); return reply(204, null); }
    if (url.includes("generativelanguage")) { calls.push({ to: "gemini" }); const next = gemini.shift(); if (!next) throw new Error("unexpected Gemini call"); return next; }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return calls;
}
const request = (body, token = "Bearer player-token") => new Request("https://app.test/api/ai", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) }, body: JSON.stringify(body) });
const PROMPT = `You are the Word Hunter vocabulary coach. Long instructions...\n\nINPUT JSON:\n{"term":"fork","existingEntry":null}`;

describe("/api/ai and the call log", () => {
  it("names the feature, previews the input, then records model, time and tokens", async () => {
    const calls = network();
    const res = await ai.POST(request({ prompt: PROMPT, task: "Ask AI about a word" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: '{"ok":true}', model: "main-model" });
    const g = calls.find((c) => c.to === "gate").body;
    expect(g).toMatchObject({ p_admin_only: false, p_kind: "ai", p_task: "Ask AI about a word", p_preview: '{"term":"fork","existingEntry":null}', p_chars: PROMPT.length });
    const f = calls.find((c) => c.to === "finish").body;
    expect(f).toMatchObject({ p_id: 77, p_ok: true, p_model: "main-model", p_http_status: 200, p_error: null, p_output_chars: 11, p_input_tokens: 320, p_output_tokens: 52 });
    expect(f.p_ms).toBeGreaterThanOrEqual(0);
    expect(calls.map((c) => c.to)).toEqual(["gate", "gemini", "finish"]);
  });

  it("records a failed call with its status and error", async () => {
    const busy = reply(400, { error: { message: "Invalid argument: bad prompt" } });
    const calls = network({ gemini: [busy] });
    const res = await ai.POST(request({ prompt: PROMPT, task: "Check a written answer" }));
    expect(res.status).toBe(502);
    const f = calls.find((c) => c.to === "finish").body;
    expect(f).toMatchObject({ p_id: 77, p_ok: false, p_http_status: 502 });
    expect(f.p_error).toMatch(/Invalid argument/);
  });

  it("a refused call never reaches Gemini, and isn't finished (the gate logged it)", async () => {
    for (const [verdict, status, text] of [
      [{ ok: false, reason: "quota", limit: 20, call: 5 }, 429, /Daily AI limit reached \(20\)/],
      [{ ok: false, reason: "admin", call: 6 }, 403, /Only the admin/],
      [{ ok: false, reason: "off", call: 7 }, 403, /turned AI off/],
    ]) {
      const calls = network({ verdict, gemini: [] });
      const res = await ai.POST(request({ prompt: PROMPT, task: "Write a story", adminOnly: true }));
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(text);
      expect(calls.map((c) => c.to)).toEqual(["gate"]);
    }
  });

  it("asks for sign-in without a token, before any network call", async () => {
    const calls = network();
    const res = await ai.POST(request({ prompt: PROMPT }, null));
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("rejects an empty or oversized prompt before the gate", async () => {
    const calls = network();
    expect((await ai.POST(request({ prompt: "  " }))).status).toBe(400);
    expect((await ai.POST(request({ prompt: "x".repeat(120001) }))).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("an older gate without a call id still answers; nothing to finish", async () => {
    const calls = network({ verdict: { ok: true } });
    const res = await ai.POST(request({ prompt: PROMPT }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.to)).toEqual(["gate", "gemini"]);
  });
});

describe("log helpers", () => {
  it("previewOf keeps the input, not the instructions", () => {
    expect(gate.previewOf(PROMPT)).toBe('{"term":"fork","existingEntry":null}');
    expect(gate.previewOf("Do this.\n\nRequests:\n[ {\"word\": \"fork\"} ]")).toBe('[ {"word": "fork"} ]');
    expect(gate.previewOf("just text")).toBe("just text");
    expect(gate.previewOf(`INPUT JSON:\n${"y".repeat(500)}`)).toHaveLength(300);
  });

  it("finishCall never throws, and gives up waiting after 1.5 s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(gate.finishCall(new Request("https://x.test"), 1, { ok: true })).resolves.toBeUndefined();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const done = gate.finishCall(new Request("https://x.test"), 1, { ok: true });
    await vi.advanceTimersByTimeAsync(1600);
    await expect(done).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("finishCall does nothing without a call id", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await gate.finishCall(new Request("https://x.test"), null, { ok: true });
    expect(f).not.toHaveBeenCalled();
  });

  it("usageOf counts thinking as output and copes with no usage data", () => {
    expect(gemini.usageOf(GEMINI_OK)).toEqual({ inputTokens: 320, outputTokens: 52 });
    expect(gemini.usageOf({})).toEqual({ inputTokens: null, outputTokens: null });
  });
});
