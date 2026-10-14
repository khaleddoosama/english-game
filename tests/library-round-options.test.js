// The questions of a round from a view, and above all their answers: a wrong
// option may come from the whole dictionary, but never one that is also right
// (a synonym, a word the author kept apart, a word with the same meaning).
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { dictionary, introduced, scopeOf, seeded } from "./libraryFixtures";

const round = (content, names, { mastery = {}, seed = 1 } = {}) =>
  V2.practice(content, mastery, null, seeded(seed), null, { questionsPerRound: 12, newWordsPerRound: 10, scope: scopeOf(names) });

// Every choice question of 30 rounds that asks about one of `names`.
function choices(content, names, mastery) {
  const out = [];
  for (let seed = 1; seed <= 30; seed++) out.push(...round(content, names, { mastery, seed }).queue.filter((q) => q.type === "mcq" && q.targets.length));
  return out;
}

describe("wrong answers in a round from a view", () => {
  // Word0 is the one that matters. The view also holds two unrelated words,
  // because a round of one new word has no question to ask yet.
  const words = dictionary(20, (i) => ({
    ...(i === 0 ? { synonyms: ["Word1"], excludeFromSameOptionsWith: ["Word4"] } : {}),   // declared on the word itself
    ...(i === 2 ? { relations: { synonyms: ["Word0 (informal)"] } } : {}),               // declared on the other word, with a qualifier
    ...(i === 3 ? { excludeFromSameOptionsWith: ["Word0"] } : {}),                       // kept apart, declared on the other side
    ...(i === 5 ? { meaning: "  Definition 0 " } : {}),                                  // the same meaning, written differently
  }));
  const content = { words };
  const rivals = ["Word1", "Word2", "Word3", "Word4", "Word5"];
  const rivalMeanings = rivals.map((n) => words.find((w) => w.word === n).meaning).filter((m) => V2.norm(m) !== V2.norm(words[0].meaning));

  it("never include a synonym, a word kept apart, or a word with the same meaning, in any direction or mode", () => {
    const seenModes = new Set();
    for (const mastery of [{}, introduced(["Word0"])]) {          // new: meaning and reverse; familiar: reverse and gap
      for (const q of choices(content, ["Word0", "Word6", "Word7"], mastery).filter((x) => x.targets[0] === "Word0")) {
        seenModes.add(q.mode);
        for (const o of q.options) {
          expect(rivals, `${q.mode}: ${o}`).not.toContain(o);
          expect(rivalMeanings, `${q.mode}: ${o}`).not.toContain(o);
        }
      }
    }
    expect([...seenModes].sort()).toEqual(["gap", "meaning", "reverse"]);   // the check really ran in every choice mode
  });

  it("are never repeated, and the right answer is there exactly once", () => {
    const all = choices(content, words.map((w) => w.word), introduced(words.map((w) => w.word)));
    expect(all.length).toBeGreaterThan(20);
    for (const q of all) {
      const keys = q.options.map(V2.norm);
      expect(new Set(keys).size, `${q.id}: ${q.options}`).toBe(keys.length);
      expect(keys.filter((k) => q.answers.map(V2.norm).includes(k))).toHaveLength(q.answers.length);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("do not give the answer away in the question", () => {
    const all = choices(content, words.map((w) => w.word), introduced(words.map((w) => w.word)));
    for (const q of all.filter((x) => x.mode !== "meaning")) expect(V2.norm(q.prompt)).not.toContain(V2.norm(q.targets[0]));
  });
});

describe("a word with nobody safe to be confused with", () => {
  // Word0 is the synonym of every other word, so no wrong option is safe for it.
  const words = dictionary(4, (i) => (i === 0 ? { synonyms: ["Word1", "Word2", "Word3"] } : {}));

  it("gets no choice question at all, and the round still builds for the others", () => {
    for (const mastery of [{}, introduced(words.map((w) => w.word))]) {
      const qs = choices({ words }, ["Word0", "Word1", "Word2"], mastery);
      expect(qs.some((q) => q.targets.includes("Word0"))).toBe(false);
      expect(qs.some((q) => q.targets.includes("Word1"))).toBe(true);
      for (const q of qs) expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("a dictionary of one word asks no choice question instead of a one-option one", () => {
    const s = round({ words: dictionary(1) }, ["Word0"]);
    expect(s.queue.filter((q) => q.type === "mcq")).toEqual([]);
  });
});
