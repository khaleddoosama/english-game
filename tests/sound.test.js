// Answer cues: a wrong answer makes an audible sound, and a suspended audio
// context (phones, before the first tap) is resumed before playing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let made, resumed;
function fakeAudio(state) {
  made = []; resumed = 0;
  class Ctx {
    constructor() { this.state = state; this.currentTime = 0; this.destination = {}; }
    resume() { resumed++; this.state = "running"; return Promise.resolve(); }
    createOscillator() { const o = { type: "", frequency: { value: 0 }, connect: (x) => x, start() {}, stop() {} }; made.push(o); return o; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }; }
  }
  vi.stubGlobal("window", { AudioContext: Ctx, addEventListener() {}, removeEventListener() {} });
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("playCue", () => {
  it("wrong: two falling notes, both high enough for a phone speaker", async () => {
    fakeAudio("running");
    const { playCue } = await import("../src/lib/sound.js");
    playCue("wrong");
    const f = made.map((o) => o.frequency.value);
    expect(f).toHaveLength(2);
    expect(f[1]).toBeLessThan(f[0]);
    expect(Math.min(...f)).toBeGreaterThan(220);
    expect(made.every((o) => o.type === "triangle")).toBe(true);
  });

  it("correct: two rising notes that climb with the combo", async () => {
    fakeAudio("running");
    const { playCue } = await import("../src/lib/sound.js");
    playCue("correct", 0); playCue("correct", 5);
    expect(made[1].frequency.value).toBeGreaterThan(made[0].frequency.value);
    expect(made[2].frequency.value).toBeGreaterThan(made[0].frequency.value);
  });

  it("a suspended audio context is resumed before the cue", async () => {
    fakeAudio("suspended");
    const { playCue } = await import("../src/lib/sound.js");
    playCue("wrong");
    expect(resumed).toBe(1);
    expect(made).toHaveLength(2);
  });

  it("no audio support: nothing happens, nothing throws", async () => {
    vi.stubGlobal("window", {});
    const { playCue } = await import("../src/lib/sound.js");
    expect(() => playCue("wrong")).not.toThrow();
  });
});
