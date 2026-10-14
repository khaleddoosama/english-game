// Which words a round from a view asks about: the view, narrowed by a lesson,
// a group, a unit or a course level; in what order the known ones come back;
// and which sentences are held back because they were read a moment ago.
import { afterEach, describe, expect, it, vi } from "vitest";
import { V2 } from "../src/engine/v2";
import { dictionary, introduced, scopeOf, seeded, word } from "./libraryFixtures";

const run = (content, scope, mastery = {}, opts = {}, seed = 3) =>
  V2.practice(content, mastery, null, seeded(seed), null, { questionsPerRound: 12, newWordsPerRound: 10, scope, ...opts });
const asked = (s) => new Set(s.queue.flatMap((q) => q.targets));

describe("a view that points at words that are gone", () => {
  const content = { words: dictionary(10) };

  it("a view whose words were all deleted from the dictionary asks nothing and does not fail", () => {
    const s = run(content, scopeOf(["Deleted1", "Deleted2"]));
    expect(s.queue).toEqual([]);
    expect(s.introductions).toEqual([]);
  });

  it("deleted words are skipped and the rest of the view is still asked", () => {
    const s = run(content, scopeOf(["Deleted1", "Word1", "Word2", "Word3"]));
    expect([...asked(s)].every((t) => ["Word1", "Word2", "Word3"].includes(t))).toBe(true);
    expect(asked(s).size).toBeGreaterThan(0);
  });

  it("a word is found by its exact text: the same word in another case is another word", () => {
    expect(run(content, scopeOf(["word1", "word2"])).queue).toEqual([]);
  });
});

describe("a view narrowed by a lesson, a group, a unit or a level", () => {
  // Twelve words in a view that spans two lessons, two groups and two course levels.
  const mixed = [
    ...dictionary(6, (i) => ({ category: "Lesson 1", subCategory: i === 4 ? undefined : i < 3 ? "Group A" : "Group B", units: i < 2 ? ["Unit One"] : [], level: i % 2 ? "A1.1" : "A1.2" })),
  ].concat(Array.from({ length: 6 }, (_, i) => word(`Other${i}`, { category: "Lesson 2", subCategory: "Group A", units: ["Unit One"], level: "A1.1" })));
  const content = { words: mixed };
  const all = mixed.map((w) => w.word);
  const inView = scopeOf(all.filter((n) => n !== "Word5"));          // Word5 is in the dictionary but not in the view
  const names = (pred) => mixed.filter(pred).map((w) => w.word).filter((n) => n !== "Word5");
  const check = (opts, expected) => {
    const targets = new Set();
    for (let seed = 1; seed <= 15; seed++) for (const t of asked(run(content, inView, introduced(all), opts, seed))) targets.add(t);
    expect([...targets].every((t) => expected.includes(t)), `${JSON.stringify(opts)}: ${[...targets]}`).toBe(true);
    expect(targets.size).toBeGreaterThan(0);
    return targets;
  };

  it("with no narrowing, the whole view and nothing outside it", () => {
    const t = check({}, names(() => true));
    expect(t.has("Word5")).toBe(false);
  });
  it("a lesson takes only the view's words from that lesson", () => {
    const r = V2.practice(content, {}, "Lesson 2", seeded(3), null, { questionsPerRound: 12, newWordsPerRound: 10, scope: inView });
    expect([...asked(r)].every((t) => t.startsWith("Other"))).toBe(true);
    expect(asked(r).size).toBeGreaterThan(0);
  });
  it("a group takes only the view's words in that group", () => check({ subCategory: "Group B" }, names((w) => w.subCategory === "Group B" && w.category === "Lesson 1")));
  it("a unit takes only the view's words in that unit, from every lesson", () => check({ unit: "Unit One" }, names((w) => w.units.includes("Unit One"))));
  it("words without a group or unit are their own round", () => {
    check({ noGroup: "unit" }, names((w) => !w.units.length));
    check({ noGroup: "subCategory" }, names((w) => !w.subCategory));
  });
  it("a course level takes only the view's words at that level", () => {
    check({ courseLevel: "A1.2" }, names((w) => w.level === "A1.2"));
    check({ courseLevel: "A1.1", unit: "Unit One" }, names((w) => w.level === "A1.1" && w.units.includes("Unit One")));
  });
  it("a level or group with none of the view's words is an empty round, not the whole dictionary", () => {
    expect(run(content, inView, {}, { courseLevel: "C2.1" }).queue).toEqual([]);
    expect(run(content, inView, {}, { subCategory: "Group Z" }).queue).toEqual([]);
    expect(run(content, scopeOf(["Word0"]), {}, { subCategory: "Group B" }).queue).toEqual([]);
  });
});

describe("what else a view round may ask", () => {
  const words = dictionary(8);
  const combos = [{ id: "c1", category: "Lesson 1", situation: "Pick the pair.", prompt: "Which two?", explanation: "Because.", words: ["Word0", "Word1"] }];
  const known = introduced(words.map((w) => w.word));
  const multi = (scope, seeds = 15) => Array.from({ length: seeds }, (_, i) => run({ words, combos }, scope, known, {}, i + 1)).flatMap((s) => s.queue.filter((q) => q.mode === "multi"));

  it("a pair question is asked only when both of its words are in the view", () => {
    expect(multi(scopeOf(["Word0", "Word1", "Word2", "Word3"])).length).toBeGreaterThan(0);
    expect(multi(scopeOf(["Word0", "Word2", "Word3", "Word4"]))).toEqual([]);   // one of the pair is outside
  });

  it("grammar rules that are not in the view are never mixed in, even from the same lesson", () => {
    const grammar = [{ id: "g-a", category: "Lesson 1", rule: "R", prompt: "Pick: ______", options: ["a", "b", "c", "d"], answer: "a", explanation: "x" }];
    const s = run({ words, grammar }, scopeOf(["Word0", "Word1", "Word2", "Word3"]), known);
    expect(s.queue.some((q) => String(q.id).startsWith("grammar:"))).toBe(false);
    expect(run({ words, grammar }, scopeOf(["Word0", "Word1", "Word2", "Word3", "Word4", "Word5"], ["g-a"]), known).queue.some((q) => String(q.id).startsWith("grammar:"))).toBe(true);
  });
});

describe("which known words come back first", () => {
  // Eight words the player knows. A round of 4 questions (the smallest there is) takes 4 of them.
  const words = dictionary(12);
  const view = scopeOf(words.slice(0, 8).map((w) => w.word));
  const record = (lastResult, lastReviewedAt) => ({ introducedAt: 1, correct: 1, total: 1, modes: { reverse: { correct: 1, total: 1 } }, lastResult, lastReviewedAt });
  const four = (mastery, seed = 3) => asked(run({ words }, view, mastery, { questionsPerRound: 4, newWordsPerRound: 0 }, seed));

  it("words missed last time come first, whatever the way they were missed", () => {
    const mastery = {
      Word0: record("correct", 10), Word1: record("wrong", 50), Word2: record("correct", 20), Word3: record("spelling", 60),
      Word4: record("assisted", 70), Word5: record("correct", 30), Word6: record("wrong", 5), Word7: record("correct", 40),
    };
    expect([...four(mastery)].sort()).toEqual(["Word1", "Word3", "Word4", "Word6"]);
  });

  it("among the rest, the least recently reviewed come first, so a right answer goes to the back", () => {
    const at = [500, 100, 300, 200, 800, 700, 600, 400];
    const mastery = Object.fromEntries(at.map((t, i) => [`Word${i}`, record("correct", t)]));
    expect([...four(mastery)].sort()).toEqual(["Word1", "Word3", "Word2", "Word7"].sort());
  });

  it("a word never reviewed counts as the oldest", () => {
    const mastery = introduced(words.slice(0, 8).map((w) => w.word));
    for (const [i, n] of ["Word0", "Word2", "Word3", "Word4", "Word5", "Word6", "Word7"].entries()) mastery[n].lastReviewedAt = 100 + i;
    delete mastery.Word1.lastReviewedAt;
    expect(four(mastery).has("Word1")).toBe(true);
  });

  it("which words come back does not depend on the random source", () => {
    const mastery = Object.fromEntries(words.slice(0, 8).map((w, i) => [w.word, record(i < 4 ? "wrong" : "correct", i + 1)]));
    for (let seed = 1; seed <= 10; seed++) expect([...four(mastery, seed)].sort()).toEqual(["Word0", "Word1", "Word2", "Word3"]);
  });
});

describe("new words in a view", () => {
  it("come in at most newWordsPerRound at a time, easier levels first", () => {
    const words = dictionary(8, (i) => ({ level: i < 4 ? "B1" : "A2" }));
    const s = run({ words }, scopeOf(words.map((w) => w.word)), {}, { newWordsPerRound: 3 });
    expect(s.introductions).toHaveLength(3);
    expect(s.introductions.every((w) => w.level === "A2")).toBe(true);
    expect(run({ words }, scopeOf(words.map((w) => w.word)), {}, { newWordsPerRound: 0 }).introductions).toEqual([]);
  });
});

describe("sentences read a moment ago", () => {
  afterEach(() => vi.useRealTimers());
  const words = dictionary(8);
  const view = scopeOf(words.map((w) => w.word));
  const known = introduced(words.map((w) => w.word));
  const gapSentences = (s) => s.queue.filter((q) => q.mode === "gap").map((q) => V2.sentence(q.prompt));

  it("are held back for SEEN_FRESH_HOURS and come back after", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.parse("2026-03-01T08:00:00Z");
    vi.setSystemTime(t0);
    const first = run({ words }, view, known, { questionsPerRound: 12 });
    const prompts = first.queue.flatMap(V2.questionSentences);
    expect(prompts.length).toBeGreaterThan(0);
    const seen = Object.fromEntries(prompts.map((p) => [p, t0]));

    vi.setSystemTime(t0 + (V2.SEEN_FRESH_HOURS * 3600000 - 1000));          // one second before it is fresh again
    const soon = run({ words }, view, known, { questionsPerRound: 12, seen });
    expect(soon.queue.flatMap(V2.questionSentences).filter((p) => prompts.includes(p))).toEqual([]);

    vi.setSystemTime(t0 + V2.SEEN_FRESH_HOURS * 3600000);                    // exactly on the hour: fresh again
    const later = run({ words }, view, known, { questionsPerRound: 12, seen });
    expect(later.queue.length).toBeGreaterThan(0);
    expect(later.queue.flatMap(V2.questionSentences).some((p) => prompts.includes(p))).toBe(true);
  });

  it("seenRecently: the edge of the window, the never seen, and a forever window", () => {
    const seen = { "she felt ______ again.": 1000 };
    const hour = 3600000;
    expect(V2.seenRecently(seen, "She felt ______ again.", 20, 1000 + 20 * hour - 1)).toBe(true);
    expect(V2.seenRecently(seen, "She felt ______ again.", 20, 1000 + 20 * hour)).toBe(false);
    expect(V2.seenRecently(seen, "Something else", 20, 1000)).toBe(false);
    expect(V2.seenRecently(seen, "she  felt ______ again. ", Infinity, 1e15)).toBe(true);   // spacing does not matter
    expect(V2.seenRecently(null, "x")).toBe(false);
  });

  it("a round where everything was read recently is shorter, not repeated", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-03-01T08:00:00Z"));
    const all = {};
    for (const w of words) all[V2.sentence(w.gap)] = Date.now();
    const s = run({ words }, view, known, { questionsPerRound: 12, seen: all });
    expect(gapSentences(s)).toEqual([]);
  });
});
