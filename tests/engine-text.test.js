import { describe, expect, it } from "vitest";
import { normalizeAnswerText } from "../src/engine/text.js";
import { fileGraph } from "./importGraph.js";

describe("normalizeAnswerText", () => {
  it("lower-cases, trims and collapses spaces", () => {
    expect(normalizeAnswerText("  Take   OFF \n")).toBe("take off");
  });
  it("makes curly apostrophes straight", () => {
    expect(normalizeAnswerText("Don’t ‘stop’")).toBe("don't 'stop'");
  });
  it("splits accents off the letter (NFKD), it does not remove them", () => {
    expect(normalizeAnswerText("Café")).toBe("café");
    expect(normalizeAnswerText("ﬁne")).toBe("fine");                         // compatibility forms are unfolded
  });
  it("nothing, null and 0 give an empty text; other values are read as text", () => {
    expect([normalizeAnswerText(), normalizeAnswerText(null), normalizeAnswerText(0), normalizeAnswerText("")]).toEqual(["", "", "", ""]);
    expect(normalizeAnswerText(12)).toBe("12");
  });
  it("lives below the question builders and the AI checks: it imports nothing", () => {
    expect(fileGraph()["engine/text"]).toEqual([]);
  });
});
