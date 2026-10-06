// /api/tts (review F05, F09): only the server writes the shared cache, with
// its own key; a link comes back only when the file is really there;
// otherwise the audio itself. The call is logged as done after the upload.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let tts;
beforeAll(async () => {
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_server";
  process.env.GEMINI_API_KEY = "key";
  process.env.GEMINI_TTS_MODEL = "tts-model";
  process.env.GEMINI_TTS_FALLBACK_MODELS = "";
  tts = await import("../api/tts.js");
});
afterEach(() => { vi.unstubAllGlobals(); process.env.SUPABASE_SECRET_KEY = "sb_secret_server"; });

const reply = (status, body = "") => ({ ok: status < 400, status, json: async () => (typeof body === "string" ? JSON.parse(body || "null") : body), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const SPOKEN = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(480).toString("base64") } }] } }] };

// heads: answers to the cache check(s), in order. upload: the storage answer, or an Error to throw.
function network({ heads = [reply(404)], verdict = { ok: true, call: 5 }, upload = reply(200, "{}"), gemini = reply(200, SPOKEN) } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    if (init.method === "HEAD") { calls.push({ to: "head" }); return heads.shift() || reply(404); }
    if (url.endsWith("/rpc/ai_gate")) { calls.push({ to: "gate" }); return reply(200, verdict); }
    if (url.endsWith("/rpc/ai_call_finish")) { calls.push({ to: "finish", body: JSON.parse(init.body) }); return reply(204); }
    if (url.includes("generativelanguage")) { calls.push({ to: "gemini", body: JSON.parse(init.body) }); return gemini; }
    if (url.includes("/storage/v1/object/tts/")) {
      calls.push({ to: "upload", headers: init.headers });
      if (upload instanceof Error) throw upload;
      return upload;
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return calls;
}
const say = (text = "see you later") => tts.POST(new Request("https://app.test/api/tts", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer player-token" }, body: JSON.stringify({ text }) }));
const isAudio = (res) => (res.headers.get("content-type") || "").startsWith("audio/");

describe("/api/tts", () => {
  it("a cached phrase plays without the gate or Gemini", async () => {
    const calls = network({ heads: [reply(200)] });
    const res = await say();
    expect(await res.json()).toMatchObject({ cached: true, url: expect.stringContaining("/storage/v1/object/public/tts/v2/") });
    expect(calls.map((c) => c.to)).toEqual(["head"]);
  });

  it("a new phrase is stored with the server's key, then logged as done, then linked", async () => {
    const calls = network();
    const res = await say();
    expect(await res.json()).toMatchObject({ cached: false, url: expect.stringContaining("/public/tts/v2/") });
    expect(calls.map((c) => c.to)).toEqual(["head", "gate", "gemini", "upload", "finish"]);
    expect(calls.find((c) => c.to === "upload").headers).toMatchObject({ apikey: "sb_secret_server", authorization: "Bearer sb_secret_server", "x-upsert": "false" });
    expect(calls.find((c) => c.to === "finish").body).toMatchObject({ p_id: 5, p_ok: true });
  });

  it("Gemini is given only the words to say, never an instruction it would read aloud", async () => {
    const calls = network();
    await say("see you later");
    const parts = calls.find((c) => c.to === "gemini").body.contents[0].parts;
    expect(parts).toEqual([{ text: "see you later" }]);
  });

  it("a storage error that isn't a duplicate returns the audio, never a link to a missing file", async () => {
    for (const upload of [
      reply(400, JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" })),
      reply(403, "{}"), reply(500, "oops"), new Error("The operation was aborted due to timeout"),
    ]) {
      network({ upload });
      const res = await say();
      expect(res.status).toBe(200);
      expect(isAudio(res)).toBe(true);
    }
  });

  it("a duplicate (another request stored it first) links only after checking it's there", async () => {
    for (const upload of [reply(409, "{}"), reply(400, JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }))]) {
      let calls = network({ heads: [reply(404), reply(200)], upload });
      expect(await (await say()).json()).toMatchObject({ cached: false });
      expect(calls.filter((c) => c.to === "head")).toHaveLength(2);
      network({ heads: [reply(404), reply(404)], upload });
      expect(isAudio(await say())).toBe(true);
    }
  });

  it("without the server key nothing is uploaded: the audio comes back directly", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const calls = network();
    const res = await say();
    expect(isAudio(res)).toBe(true);
    expect(calls.map((c) => c.to)).toEqual(["head", "gate", "gemini"]);
  });

  it("refused by the gate: no Gemini, no upload", async () => {
    for (const [verdict, status] of [[{ ok: false, reason: "quota", limit: 3, call: 1 }, 429], [{ ok: false, reason: "off", call: 2 }, 403]]) {
      const calls = network({ verdict });
      expect((await say()).status).toBe(status);
      expect(calls.map((c) => c.to)).toEqual(["head", "gate"]);
    }
  });

  it("Gemini failing is logged as an error and nothing is stored", async () => {
    const calls = network({ gemini: reply(400, { error: { message: "Invalid argument" } }) });
    const res = await say();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(calls.map((c) => c.to)).toEqual(["head", "gate", "gemini", "finish"]);
    expect(calls.find((c) => c.to === "finish").body.p_ok).toBe(false);
  });
});
