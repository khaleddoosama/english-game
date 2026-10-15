// A round from a view that holds one new word: the word is introduced and then
// asked once, so the round is not just a card with nothing to answer. The rule
// "the word just introduced is never the first question" stays for every round
// that has something else to ask. The answer counts like any first answer
// (a word becomes Familiar, not Learned or Mastered); nothing about mastery
// changed, and no question is invented.
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { dictionary, introduced, scopeOf, seeded } from "./libraryFixtures";

const run = (words, view, mastery = {}, seed = 3, opts = {}) =>
  V2.practice({ words }, mastery, null, seeded(seed), null, { questionsPerRound: 12, newWordsPerRound: 10, scope: scopeOf(view), ...opts });

describe("a view with one new word", () => {
  const words = dictionary(12);

  it("introduces the word and then asks about it, whatever the random draw", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = run(words, ["Word0"], {}, seed);
      expect(s.introductions.map((w) => w.word), `seed ${seed}`).toEqual(["Word0"]);
      expect(s.queue.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(s.queue.every((q) => q.targets.length === 1 && q.targets[0] === "Word0")).toBe(true);
    }
  });

  it("the question is a real one: its answer is among its options, and the prompt does not give the word away", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const q = run(words, ["Word0"], {}, seed).queue[0];
      expect(q.type).toBe("mcq");
      const options = q.options.map(V2.norm);
      expect(new Set(options).size).toBe(options.length);
      expect(q.answers.every((a) => options.includes(V2.norm(a)))).toBe(true);
      if (q.mode !== "meaning") expect(V2.norm(q.prompt)).not.toContain("word0");
    }
  });

  it("it is marked as the first practice of the word", () => {
    expect(run(words, ["Word0"]).queue[0].initialTraining).toBe(true);
  });

  it("a right answer is a first right answer: Familiar, one step, no production credit, not Learned or Mastered", () => {
    const s = run(words, ["Word0"]);
    const done = { ...s, answers: s.queue.map(() => ({ correct: true })) };
    const m = V2.sessionEvidence({}, { ...done, id: "round-1", kind: "practice" }, 1_800_000_000_000).Word0;
    expect(V2.stage(m)).toBe("Familiar");
    expect(m).toMatchObject({ correct: 1, reviewStep: 1, productionCorrect: 0 });
    expect(m.independentSessions).toEqual(["round-1"]);                      // one round; Mastered needs three
  });

  it("a wrong answer sets nothing back that was not there: the word is still new, with a miss on record", () => {
    const s = run(words, ["Word0"]);
    const m = V2.sessionEvidence({}, { ...s, answers: s.queue.map(() => ({ correct: false })), id: "r", kind: "practice" }, 1).Word0;
    expect(V2.stage(m)).toBe("New");
    expect(m).toMatchObject({ correct: 0, total: 1, lastResult: "wrong", reviewStep: 0 });
  });

  it("when no valid question can be built, the round stays a card: nothing is invented", () => {
    const lonely = dictionary(4, (i) => (i === 0 ? { synonyms: ["Word1", "Word2", "Word3"] } : {}));
    const s = run(lonely, ["Word0"]);
    expect(s.introductions.map((w) => w.word)).toEqual(["Word0"]);
    expect(s.queue).toEqual([]);
  });
});

describe("rounds that have something else to ask are as they were", () => {
  const words = dictionary(12);

  it("the word just introduced is still not the first question", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = run(words, ["Word0", "Word1", "Word2"], {}, seed);
      const last = s.introductions.at(-1).word;
      expect(s.queue[0].targets, `seed ${seed}`).not.toContain(last);
      expect(s.queue.some((q) => q.initialTraining)).toBe(false);
    }
  });

  it("a known word and a new one: the known one is asked first", () => {
    const s = run(words, ["Word0", "Word1"], introduced(["Word1"]));
    expect(s.introductions.map((w) => w.word)).toEqual(["Word0"]);
    expect(s.queue[0].targets).toEqual(["Word1"]);
  });

  it("a round of one known word is as before (it was never affected)", () => {
    const s = run(words, ["Word0"], introduced(["Word0"]));
    expect(s.introductions).toEqual([]);
    expect(s.queue.length).toBeGreaterThan(0);
    expect(s.queue.some((q) => q.initialTraining)).toBe(false);
  });
});
