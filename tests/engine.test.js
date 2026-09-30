// Engine tests against the real backup, so a refactor that changes how the
// game builds levels, grades answers or migrates progress shows up here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { LEVELS, WORDS, mergeCustomData } from "../src/engine/data";
import { migrateProgressData } from "../src/engine/progress";
import { liveBoard, livePoints, liveQuestions } from "../src/features/live/liveEngine";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const content = V2.withoutRemovedFields(backup);
mergeCustomData(content.words, content.grammar, content.challenges, content.levelOrder);

// Small seeded RNG so question building is repeatable.
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("content", () => {
  it("loads every backup word into levels", () => {
    expect(WORDS.length).toBe(content.words.length);
    expect(LEVELS.length).toBe(backup.levelOrder.length);
    const inLevels = LEVELS.flatMap((l) => l.items).filter((it) => it.kind === "word").length;
    expect(inLevels).toBe(WORDS.length);
  });

  it("normalizes a v3 import without errors", () => {
    const v3 = JSON.parse(readFileSync(new URL("../imports/health-body-v3.json", import.meta.url), "utf8"));
    const out = V2.normalizeV3(v3, content);
    expect(out.errors).toEqual([]);
    expect(out.content.words.length).toBe(v3.words.length);
    expect(out.content.words.every((w) => typeof w.category === "string")).toBe(true);
  });
});

describe("grading", () => {
  const q = { type: "typing", answers: ["campaign"], mode: "typing" };
  it("accepts the answer regardless of case and spacing", () => {
    expect(V2.grade(q, "  Campaign ").correct).toBe(true);
  });
  it("flags a one-letter slip as spelling, not correct", () => {
    const r = V2.grade(q, "campaing", WORDS);
    expect(r.correct).toBe(false);
  });
  it("rejects a different word", () => {
    expect(V2.grade(q, "budget", WORDS).correct).toBe(false);
  });
});

describe("progress", () => {
  it("migrates the backup without losing mastery or score", () => {
    const data = migrateProgressData(backup);
    expect(data.score).toBe(backup.score);
    expect(Object.keys(data.mastery).length).toBe(Object.keys(backup.mastery).length);
  });

  it("builds a practice session from real content", () => {
    const data = migrateProgressData(backup);
    const s = V2.practice(content, data.mastery, LEVELS[1].title, seeded(), null, { pools: data.pools });
    expect(s.queue.length).toBeGreaterThan(0);
    for (const q of s.queue) expect(Array.isArray(q.answers)).toBe(true);
  });
});

describe("live challenge", () => {
  it("builds multiple-choice questions that carry their answer", () => {
    const words = LEVELS[1].items.filter((it) => it.kind === "word").map((it) => it.obj);
    const qs = liveQuestions(words, 10, { rng: seeded(3) });
    expect(qs.length).toBe(10);
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      expect(q.options.map(V2.norm)).toContain(V2.norm(q.answer));
    }
  });

  it("scores speed and ranks players", () => {
    expect(livePoints({ correct: true, ms: 0 }, 20000)).toBe(1000);
    expect(livePoints({ correct: true, ms: 20000 }, 20000)).toBe(500);
    expect(livePoints({ correct: false, ms: 10 }, 20000)).toBe(0);
    const room = { seconds: 20, players: [
      { id: "a", name: "A", answers: { 0: { correct: true, ms: 15000 } } },
      { id: "b", name: "B", answers: { 0: { correct: true, ms: 1000 } } },
    ] };
    expect(liveBoard(room, 0).map((p) => p.id)).toEqual(["b", "a"]);
  });
});
