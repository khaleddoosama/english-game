// The AI call survives Gemini load spikes: retries a busy model, falls back
// to the next one, skips rate-limited or missing models, drops thinking
// settings a model rejects, and reports a clear "busy" error at the end.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let gemini;
beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "main-model";
  process.env.GEMINI_FALLBACK_MODELS = "backup-a,backup-b";
  gemini = await import("../api/_lib/gemini.js");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fail = (status, message) => ({ ok: false, status, json: async () => ({ error: { code: status, message } }) });
const BUSY = "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";
const quiet = { log: {} };

function stubFetch(responses) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    calls.push({ model: /models\/([^:]+):/.exec(url)[1], body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next;
  }));
  return calls;
}
const body = (model, plain) => ({ plain, model });

describe("gemini fallback", () => {
  it("retries a busy model once, then answers", async () => {
    const calls = stubFetch([fail(503, BUSY), ok('{"a":1}')]);
    const { model } = await gemini.generateWithFallback(["main-model", "backup-a"], body, quiet);
    expect(model).toBe("main-model");
    expect(calls.map((c) => c.model)).toEqual(["main-model", "main-model"]);
  });

  it("moves to the next model when the main one stays busy", async () => {
    const calls = stubFetch([fail(503, BUSY), fail(503, BUSY), ok("{}")]);
    const { model } = await gemini.generateWithFallback(["main-model", "backup-a"], body, quiet);
    expect(model).toBe("backup-a");
    expect(calls.map((c) => c.model)).toEqual(["main-model", "main-model", "backup-a"]);
  });

  it("skips rate-limited and missing models without waiting", async () => {
    const calls = stubFetch([fail(429, "quota"), fail(404, "not found"), ok("{}")]);
    const { model } = await gemini.generateWithFallback(["main-model", "gone-model", "backup-b"], body, quiet);
    expect(model).toBe("backup-b");
    expect(calls).toHaveLength(3);
  });

  it("drops thinking settings when a model rejects them", async () => {
    const calls = stubFetch([fail(400, "thinkingLevel is not supported for this model"), ok("{}")]);
    await gemini.generateWithFallback(["main-model"], body, quiet);
    expect(calls.map((c) => c.body.plain)).toEqual([false, true]);
  });

  it("ends with a clear busy error when every model is overloaded", async () => {
    stubFetch([fail(503, BUSY), fail(503, BUSY), fail(503, BUSY), fail(503, BUSY)]);
    await expect(gemini.generateWithFallback(["main-model", "backup-a"], body, quiet)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/busy/) });
  });

  it("does not hide a real request error behind retries", async () => {
    const calls = stubFetch([fail(400, "Invalid JSON payload")]);
    await expect(gemini.generateWithFallback(["main-model", "backup-a"], body, quiet)).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(1);
  });

  it("uses the configured fallback chain for JSON text", async () => {
    const calls = stubFetch([fail(503, BUSY), fail(503, BUSY), ok('{"x":1}')]);
    const out = await gemini.generateJsonText("hi");
    expect(out).toEqual({ text: '{"x":1}', model: "backup-a", usage: { inputTokens: null, outputTokens: null } });
    expect(calls[2].body.generationConfig.responseMimeType).toBe("application/json");
  });
});
