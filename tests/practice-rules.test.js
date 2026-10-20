// Starting rounds, the rules (src/features/practice/practiceRules.js): a lesson and its groups, a course level and its
// parts, new words after a strong or weak round (and the message), words whose gap sentences are used up (8 at most),
// a lesson's stars, the Speed Round's queue (mastered words, never the same twice in a row) and session, and the extra
// question style per word. Made-up words. Docs: docs/modules/practice/starting-rounds.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import { V2 } from "../src/engine/v2";
import * as R from "../src/features/practice/practiceRules";

const W = (word, category, extra = {}) => ({ word, type: "vocab", category, meaning: `The meaning of ${word}.`, situation: `We talked about the ${word} today.`, gap: "We talked about the ______ today.", ...extra });
const WORDS = [W("Drizzle", "Weather", { level: "A1.2", units: ["Unit-1"] }), W("Gust", "Weather", { level: "A1.2" }), W("Lobby", "Hotel", { level: "A1.3" }), W("Suite", "Hotel")];
const names = (inRound) => WORDS.filter(inRound).map((w) => w.word);
afterEach(() => vi.restoreAllMocks());

describe("what a round holds", () => {
  it("a lesson; one of its units; a sub-category; words in no group", () => {
    const level = { id: "cat-Weather", title: "Weather" };
    const all = R.lessonStart(level);
    expect([all.title, all.category, all.narrow, names(all.inRound)]).toEqual(["Weather", "Weather", {}, ["Drizzle", "Gust"]]);
    expect(R.lessonStart(level, { id: "Unit-1", title: "Unit 1", field: "unit" }).narrow).toEqual({ title: "Weather · Unit 1", unit: "Unit-1" });
    expect(R.lessonStart(level, { id: "Rain", title: "Rain", field: "subCategory" }).narrow).toEqual({ title: "Weather · Rain", subCategory: "Rain" });
    expect(R.lessonStart(level, { id: null, title: "Other words", field: "unit" }).narrow).toEqual({ title: "Weather · Other words", noGroup: "unit" });
  });

  it("a course level; one of its sessions; its words in no session; the words with no level", () => {
    const a12 = { id: "A1.2" };
    const all = R.courseLevelStart(a12);
    expect([all.title, all.narrow, names(all.inRound)]).toEqual(["A1.2", { title: "A1.2", courseLevel: "A1.2" }, ["Drizzle", "Gust"]]);
    const unit = R.courseLevelStart(a12, { unit: "Unit-1", title: "Unit 1" });
    expect([unit.title, unit.narrow.unit, names(unit.inRound)]).toEqual(["A1.2 · Unit 1", "Unit-1", ["Drizzle"]]);
    expect(R.courseLevelStart(a12, { unit: "Unit-1" }).title).toBe("A1.2 · Unit-1");
    const other = R.courseLevelStart(a12, { noUnit: true });
    expect([other.title, other.narrow.noGroup, names(other.inRound)]).toEqual(["A1.2 · Other words", "unit", ["Gust"]]);
    const none = R.courseLevelStart(null);
    expect([none.title, none.narrow, names(none.inRound)]).toEqual(["No course level", { title: "No course level", noCourseLevel: true }, ["Suite"]]);
  });
});

describe("new words", () => {
  const log = (correct, extra = {}) => ({ kind: "practice", title: "Weather", correct, total: 10, ...extra });
  it("follow the last round with the same title: +2 after 90% or more (10 at most), -2 under 60% (1 at least)", () => {
    expect(R.newWordsFor(3, [log(9)], "Weather")).toBe(5);
    expect(R.newWordsFor(9, [log(10)], "Weather")).toBe(10);
    expect(R.newWordsFor(3, [log(5)], "Weather")).toBe(1);
    expect(R.newWordsFor(2, [log(5)], "Weather")).toBe(1);
    expect(R.newWordsFor(3, [log(6)], "Weather")).toBe(3);
    expect(R.newWordsFor(3, [log(8.9)], "Weather")).toBe(3);
  });

  it("only the newest practice round of that title with questions counts; 0 stays 0", () => {
    expect(R.newWordsFor(3, [log(2, { title: "Hotel" }), log(0, { kind: "story" }), log(0, { total: 0 }), log(10)], "Weather")).toBe(5);
    expect(R.newWordsFor(3, [log(10), log(0)], "Weather")).toBe(5);
    expect(R.newWordsFor(3, [], "Weather")).toBe(3);
    expect(R.newWordsFor(0, [log(10)], "Weather")).toBe(0);
  });

  it("the message only when the strong round brought more new words this time", () => {
    expect(R.moreNewWordsText(3, 5, 5)).toBe("Strong last round here — 5 new words this time.");
    expect(R.moreNewWordsText(3, 5, 4)).toBe("Strong last round here — 4 new words this time.");
    expect(R.moreNewWordsText(3, 5, 3)).toBe(null);
    expect(R.moreNewWordsText(3, 3, 5)).toBe(null);
  });
});

describe("used-up gap sentences", () => {
  const known = { stage: "Familiar", total: 3, correct: 2, introducedAt: 1 };
  const read = (t) => ({ [V2.norm(t)]: Date.now() });
  it("known words of the round whose gap sentences were all read recently", () => {
    const inRound = (w) => w.category === "Weather";
    const seen = read("We talked about the ______ today.");
    expect(R.usedUpGapWords(WORDS, inRound, { Drizzle: known, Gust: known, Lobby: known }, {}, seen).map((w) => w.word)).toEqual(["Drizzle", "Gust"]);
    expect(R.usedUpGapWords(WORDS, inRound, { Drizzle: known }, {}, seen).map((w) => w.word)).toEqual(["Drizzle"]);
    expect(R.usedUpGapWords(WORDS, inRound, { Drizzle: known }, {}, {})).toEqual([]);
    const pools = { Drizzle: { gap: [{ id: "g2", text: "Another ______ here.", attempts: 0, correctCount: 0, lockedUntil: null }] } };
    expect(R.usedUpGapWords(WORDS, inRound, { Drizzle: known }, pools, seen)).toEqual([]);
  });

  it("8 at most; no gap sentence, no new ones", () => {
    const many = Array.from({ length: 12 }, (_, i) => W(`Word${i}`, "Weather"));
    const mastery = Object.fromEntries(many.map((w) => [w.word, known]));
    expect(R.usedUpGapWords(many, () => true, mastery, {}, read("We talked about the ______ today."))).toHaveLength(8);
    expect(R.GAP_REFRESH_MAX).toBe(8);
    expect(R.usedUpGapWords([W("Plain", "Weather", { gap: "No blank here." })], () => true, { Plain: known }, {}, {})).toEqual([]);
  });
});

it("a lesson's stars: its best, and at least one once cleared", () => {
  expect(R.lessonStars({ a: { stars: 2 } }, new Set(), "a")).toBe(2);
  expect(R.lessonStars({}, new Set(["a"]), "a")).toBe(1);
  expect(R.lessonStars({ a: { stars: 3 } }, new Set(["a"]), "a")).toBe(3);
  expect(R.lessonStars({}, new Set(), "a")).toBe(0);
});

describe("the Speed Round", () => {
  const content = { words: WORDS, grammar: [], challenges: [] };
  it("needs 5 mastered words; questions about them, never the same twice in a row; at most the size asked", () => {
    expect(R.MIN_MASTERED_FOR_SPEED).toBe(5);
    let seed = 3; vi.spyOn(Math, "random").mockImplementation(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });
    const queue = R.speedQueue(content, WORDS, 12);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.length).toBeLessThanOrEqual(12);
    expect(queue.every((q, i) => i === 0 || q.answers[0] !== queue[i - 1].answers[0])).toBe(true);
    expect(queue.every((q) => WORDS.some((w) => w.word === q.answers[0]))).toBe(true);
    expect(R.speedQueue(content, [], 12)).toEqual([]);
  });

  it("a timed session from now", () => {
    const q = [{ id: "q1" }];
    expect(R.speedSession(q, 45, 1000)).toEqual({ kind: "speed", id: "speed-1000", title: "Speed Round", queue: q, index: 0, answers: [], introductions: [], seconds: 45, deadline: 46000 });
  });
});

describe("the extra question style per word", () => {
  const content = { words: [W("Drizzle", "Weather", { antonyms: ["Downpour"] }), W("Gust", "Weather"), W("Breeze", "Weather"), W("Hail", "Weather"), W("Frost", "Weather")], grammar: [], challenges: [] };
  const opts = { pools: {}, seen: {}, imageOk: () => true };
  const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  it("about the word, with an id from the word and its mode; never a prompt that gives the answer away", () => {
    let built = 0;
    for (let s = 1; s < 80; s++) {
      for (const stage of ["Familiar", "Learned"]) {
        const q = R.practiceExtra(content, content.words[0], stage, opts, seeded(s));
        if (!q) continue;
        built++;
        expect(q.targets).toContain("Drizzle");
        if (!["collocation", "family", "picture"].includes(q.mode)) expect(q.id).toBe(`Drizzle:${q.mode}`);
        expect((q.answers || []).every((a) => String(a).length <= 2 || !q.prompt.toLowerCase().includes(String(a).toLowerCase()))).toBe(true);
      }
    }
    expect(built).toBeGreaterThan(0);
  });

  it("typed once the word is Learned (the opposite clue)", () => {
    const one = { ...opts };
    const clue = (stage) => { for (let s = 1; s < 400; s++) { const q = R.practiceExtra(content, content.words[0], stage, one, seeded(s)); if (q?.mode === "antonym") return q; } return null; };
    expect(clue("Learned")?.type).toBe("typing");
    const mcq = clue("Familiar");
    if (mcq) expect([mcq.type, mcq.options.includes("Drizzle")]).toEqual(["mcq", true]);
  });

  it("no style fits: none", () => {
    expect(R.practiceExtra({ words: [W("Lone", "X")], grammar: [], challenges: [] }, W("Lone", "X"), "Familiar", opts, seeded(5))).toBe(null);
  });
});
