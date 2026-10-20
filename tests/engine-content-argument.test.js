// MT-02 step 2: the engine builds questions, picks modes and counts badges from the content it is given (the engine
// keeps no copy). Nothing here calls setGameContent, so the content module's copy stays empty: every result can only
// come from the argument. Made-up content. Docs: docs/modules/content/content-catalog.md.
import { describe, expect, it } from "vitest";
import { gameContent } from "../src/features/content";
import { buildCatalog } from "../src/engine/catalog";
import { courseLevelGroups } from "../src/engine/data";
import { buildQuestion, buildSelectTwoQuestion, buildSpeedQuestion, buildTwoPeopleQuestion, findWordByLabel, getAllowedModes, legacyQuestionToV2, selectAdaptiveMode, v2SessionFromEntries } from "../src/engine/questions";
import { getBadgeProgress } from "../src/engine/progress";

const W = (word, extra = {}) => ({ word, type: "vocab", category: "Weather", meaning: `The weather word ${word.toLowerCase()} for the test.`, situation: `We saw it near the hotel (${word.length}).`, gap: `We saw the ______ near the hotel (${word.length}).`, ...extra });
const content = buildCatalog(
  [W("Gust", { meaning: "A sudden strong rush of wind.", antonyms: ["Calm"] }), W("Calm", { meaning: "Still air with no wind." }), W("Drizzle", { meaning: "Light rain in small drops." }), W("Hail", { meaning: "Small balls of ice that fall." }), W("Fog", { meaning: "Thick cloud near the ground." })],
  [{ id: "g1", category: "Weather", rule: "Past simple" }],
  [{ id: "c1", type: "story", category: "Weather", linkedWords: ["Gust", "Unknown"], prompt: "Which word?", options: ["Gust", "Calm"], answer: "Gust" }],
  ["Weather", "Empty"],
);
const gust = content.words[0];
const names = content.words.map((w) => w.word);

it("the content module's copy stays empty in this file", () => {
  expect(gameContent().words).toEqual([]);
});

describe("questions come from the given words", () => {
  it("options are words of the given content", () => {
    for (const mode of ["meaning", "gap", "situation", "whoami"]) {
      const q = buildQuestion(content, mode, gust, {}, { difficulty: 2 });
      expect(q.options.length, mode).toBe(4);
      expect(q.options.every((o) => names.includes(o)), mode).toBe(true);
    }
  });
  it("an opposite comes from the given words (linked antonyms)", () => {
    const answers = new Set();
    for (let i = 0; i < 40; i++) {
      const q = buildQuestion(content, "opposite", gust, {}, {});
      expect(q.options.every((o) => names.includes(o) || /opposites$/.test(o))).toBe(true);
      answers.add(q.answer);
    }
    expect(answers).toContain("Calm");
    expect(findWordByLabel(content, " calm ")).toBe(content.words[1]);
    expect(findWordByLabel({ words: [] }, "Calm")).toBe(null);
  });
  it("when the usual wrong options run short, the opposite question fills up from the given words", () => {
    // "Open up" is a synonym of the target, so the usual wrong options leave it out; the fill-up may still use it.
    const mixed = buildCatalog([W("Break the ice", { meaning: "To start talking in a cold room.", antonyms: ["Keep quiet"], synonyms: ["Open up"] }), W("Keep quiet", { meaning: "To say nothing." }), W("Open up", { meaning: "To begin to talk freely." }), W("Hail"), W("Fog")], [], [], ["Weather"]);
    let direct = 0;
    for (let i = 0; i < 60; i++) {
      const q = buildQuestion(mixed, "opposite", mixed.words[0], {}, {});
      if (q.prompt !== "Break the ice" || q.answer !== "Keep quiet") continue;
      direct++;
      expect(q.options).toHaveLength(4);
    }
    expect(direct).toBeGreaterThan(5);
  });
  it("a story challenge linked to the word is found in the given challenges; unknown linked words are dropped", () => {
    const q = buildQuestion(content, "story", gust, {}, {});
    expect(q.challengeId).toBe("c1");
    expect(q.linkedWords).toEqual(["Gust"]);
    const [v2] = legacyQuestionToV2(content, q, { kind: "challenge", obj: content.challenges[0] }, "1");
    expect(v2.progressKeys).toEqual(["challenge:c1", "Gust"]);
  });
  it("two-person questions need a companion among the given words", () => {
    expect(getAllowedModes(content, gust)).toEqual(expect.arrayContaining(["twopeople", "selecttwo"]));
    const alone = buildCatalog([W("Gust")], [], [], ["Weather"]);
    expect(getAllowedModes(alone, alone.words[0])).not.toContain("twopeople");
    expect(buildTwoPeopleQuestion(alone, alone.words[0])).toBe(null);
    const pair = buildSelectTwoQuestion(content, gust);
    expect(pair.correctAnswers[0]).toBe("Gust");
    expect(names).toContain(pair.correctAnswers[1]);
  });
  it("speed questions and sessions use the given words", () => {
    const q = buildSpeedQuestion(content, [gust]);
    expect(q.options.every((o) => names.includes(o))).toBe(true);
    const session = v2SessionFromEntries(content, [{ kind: "word", wordObj: gust, mode: "meaning", difficulty: 2 }, { kind: "challenge", obj: content.challenges[0] }], { kind: "weak", title: "T" });
    expect(session.queue.map((q) => q.targets)).toEqual([["Gust"], ["Gust"]]);
  });
  it("mode choice reads the given words", () => {
    expect(getAllowedModes(content, gust)).toContain(selectAdaptiveMode(content, gust, undefined, {}));
  });
});

describe("other engine helpers take the lists", () => {
  it("badges are counted against the given levels", () => {
    const level = getBadgeProgress({ type: "category", category: "Weather" }, { mastery: {}, bestStreak: 0, levels: content.levels });
    expect(level).toEqual({ done: 0, total: 7, earned: false });
    expect(getBadgeProgress({ type: "category", category: "Empty" }, { mastery: {}, bestStreak: 0, levels: content.levels }).earned).toBe(true);
    expect(getBadgeProgress({ type: "completionist" }, { mastery: {}, bestStreak: 0, levels: content.levels }).earned).toBe(false);
    expect(getBadgeProgress({ type: "completionist" }, { mastery: {}, bestStreak: 0, levels: [] }).earned).toBe(true);
  });
  it("course levels are built only from the lists given", () => {
    const words = [W("Gust", { level: "A1.1", units: ["u1"] })];
    expect(courseLevelGroups(words, []).levels.map((l) => l.id)).toEqual(["A1.1"]);
  });
});
