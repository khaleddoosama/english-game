import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestTimeout } from "../src/lib/requestTimeout.js";

vi.mock("../src/lib/auth", () => ({ accessToken: vi.fn(async () => "token") }));
vi.mock("../src/lib/supabase", () => ({ isLocalMode: false }));
import { accessToken } from "../src/lib/auth";
import { AI_REQUEST_TIMEOUT_MS, callAiText } from "../src/lib/ai.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); accessToken.mockResolvedValue("token"); });
const never = () => new Promise(() => {});

describe("AI deadlines", () => {
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
