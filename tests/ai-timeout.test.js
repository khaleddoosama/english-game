import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestTimeout } from "../src/lib/requestTimeout.js";

vi.mock("../src/lib/auth", () => ({ accessToken: vi.fn(async () => "token") }));
vi.mock("../src/lib/supabase", () => ({ isLocalMode: false }));
import { accessToken } from "../src/lib/auth";
import { AI_REQUEST_TIMEOUT_MS, callAiText, speechUrl } from "../src/lib/ai.js";
import { cancelAiTasks } from "../src/lib/aiOperations.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); accessToken.mockResolvedValue("token"); });
const never = () => new Promise(() => {});

describe("AI deadlines", () => {
  it("cancels speech generation without saving a broken cache entry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const pending = speechUrl("new uncached cancellation test phrase");
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    cancelAiTasks(["Pronunciation"]); await checked;
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://example.test/ok.wav" })));
    await expect(speechUrl("new uncached cancellation test phrase")).resolves.toBe("https://example.test/ok.wav");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("settles and aborts even when the operation ignores the signal", async () => {
    vi.useFakeTimers();
    let signal;
    const result = withRequestTimeout((s) => { signal = s; return never(); }, 100, "Timed out");
    const checked = expect(result).rejects.toMatchObject({ name: "TimeoutError", message: "Timed out" });
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["authentication", "connection", "body"])("bounds stalled %s", async (stage) => {
    vi.useFakeTimers();
    accessToken.mockImplementation(stage === "authentication" ? never : async () => "token");
    const fetcher = vi.fn(stage === "connection" ? never : async () => ({ ok: true, headers: new Headers(), json: never }));
    vi.stubGlobal("fetch", fetcher);
    const result = callAiText("prompt", { task: "Review a reported question" });
    const checked = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    await checked;
    if (stage === "authentication") expect(fetcher).not.toHaveBeenCalled();
    else expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects empty responses and preserves server errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })));
    await expect(callAiText("prompt")).rejects.toThrow(/no usable response/);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Quota reached" }), { status: 429 }));
    await expect(callAiText("prompt")).rejects.toThrow("Quota reached");
  });
});
