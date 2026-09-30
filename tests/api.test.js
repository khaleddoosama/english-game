// Server helpers that don't need the network.
import { describe, expect, it } from "vitest";
import { wav } from "../api/_lib/gemini.js";

describe("wav", () => {
  it("wraps 24 kHz 16-bit mono PCM in a valid header", () => {
    const pcm = Buffer.alloc(4800); // 0.1 s
    const out = wav(pcm, 24000);
    expect(out.length).toBe(44 + 4800);
    expect(out.toString("ascii", 0, 4)).toBe("RIFF");
    expect(out.toString("ascii", 8, 12)).toBe("WAVE");
    expect(out.readUInt32LE(24)).toBe(24000);      // sample rate
    expect(out.readUInt32LE(28)).toBe(48000);      // byte rate
    expect(out.readUInt32LE(40)).toBe(4800);       // data size
  });
});
