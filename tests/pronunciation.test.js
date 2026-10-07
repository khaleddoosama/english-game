// Pronunciation keeps working when the dialog is closed: the lookup is its
// own job, shared between askers, and the result is remembered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speechUrl = vi.fn();
vi.mock("../src/lib/ai", () => ({ speechUrl: (...a) => speechUrl(...a), forgetSpeechUrl: vi.fn() }));
const { preparePronunciation, forgetPronunciation, audioCache, readyPronunciation } = await import("../src/features/media/media.jsx");

const dictionary = (entries) => vi.fn(async () => ({ ok: true, status: 200, json: async () => entries }));
beforeEach(() => { audioCache.clear(); readyPronunciation.clear(); speechUrl.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("preparePronunciation", () => {
  it("a phrase goes to Gemini's voice with nobody listening, and the link comes back", async () => {
    speechUrl.mockResolvedValue("https://cdn.test/tts/v2/abc.wav");
    // The dialog is closed: nothing subscribes, the job still runs and finishes.
    const job = preparePronunciation("see you later");
    expect(await job).toEqual({ source: "ai", url: "https://cdn.test/tts/v2/abc.wav", isUS: true });
    expect(speechUrl).toHaveBeenCalledTimes(1);
  });

  it("a word with an American recording uses it and never asks Gemini", async () => {
    vi.stubGlobal("fetch", dictionary([{ phonetics: [{ audio: "https://dict.test/hello-uk.mp3" }, { audio: "https://dict.test/hello-us.mp3" }] }]));
    expect(await preparePronunciation("Hello")).toEqual({ source: "human", url: "https://dict.test/hello-us.mp3", isUS: true });
    expect(speechUrl).not.toHaveBeenCalled();
  });

  it("a word the dictionary can't find, or a dictionary that is unreachable, falls through to Gemini", async () => {
    speechUrl.mockResolvedValue("https://cdn.test/tts/v2/x.wav");
    vi.stubGlobal("fetch", dictionary([]));
    expect((await preparePronunciation("zzzword")).source).toBe("ai");
    audioCache.clear();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("blocked"); }));
    expect((await preparePronunciation("anotherword")).source).toBe("ai");
  });

  it("asking again while it is still working shares the same job: one request", async () => {
    let finish;
    speechUrl.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = preparePronunciation("keep going");
    const again = preparePronunciation("Keep  going"); // the dialog reopened
    expect(again).toBe(first);
    await new Promise((r) => setTimeout(r, 0)); // the job reaches Gemini
    finish("https://cdn.test/tts/v2/k.wav");
    await first;
    expect(speechUrl).toHaveBeenCalledTimes(1);
  });

  it("when neither source works it rejects, so the dialog can fall back to the browser's voice", async () => {
    speechUrl.mockRejectedValue(new Error("AI is off"));
    await expect(preparePronunciation("no luck here")).rejects.toThrow("AI is off");
  });

  it("opening the same word again plays at once: no dictionary search, no request for the voice", async () => {
    speechUrl.mockResolvedValue("https://cdn.test/tts/v2/r.wav");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await preparePronunciation("Rarely");
    const again = await preparePronunciation("rarely");
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(speechUrl).toHaveBeenCalledTimes(1);
  });

  it("a word the dictionary doesn't have (404) is remembered: it isn't searched again even if the result is forgotten", async () => {
    speechUrl.mockResolvedValue("https://cdn.test/tts/v2/u.wav");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await preparePronunciation("Unrestrained")).source).toBe("ai");
    forgetPronunciation("Unrestrained");               // e.g. the recording failed to play
    expect((await preparePronunciation("Unrestrained")).source).toBe("ai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a dictionary that is only having a bad moment (500) is not remembered as 'no recording'", async () => {
    speechUrl.mockResolvedValue("https://cdn.test/tts/v2/m.wav");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await preparePronunciation("Mishap");
    forgetPronunciation("Mishap");
    await preparePronunciation("Mishap");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
