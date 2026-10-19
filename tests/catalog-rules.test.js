// The game's copy of the content, built in one step (src/engine/catalog.js): words one per text, grammar rules and
// challenges one per id, opposites linked, the levels and the badges; and mergeCustomData keeping it in engine/data.
// Made-up content. Docs: docs/modules/content/content-catalog.md.
import { describe, expect, it } from "vitest";
import { badgesFor, buildCatalog, buildLevel, dedupeBy } from "../src/engine/catalog";
import * as Data from "../src/engine/data";

const W = (word, category = "Weather", extra = {}) => ({ word, type: "vocab", category, meaning: `The meaning of ${word}.`, ...extra });
const words = (list) => list.map((w) => w.word);

describe("dedupeBy", () => {
  it("keeps the first item per key and drops items with no key", () => {
    const a = { k: "a", n: 1 }, b = { k: "b" }, again = { k: "a", n: 2 };
    expect(dedupeBy([a, { k: "" }, b, again, { k: null }], (x) => x.k)).toEqual([a, b]);
  });
});

describe("buildCatalog", () => {
  it("words: one per text, trimmed and lower-cased, the first wins; a word with no text is dropped", () => {
    const c = buildCatalog([W("Gust"), W(" gust", "Climate"), W("GUST "), W(""), W(undefined), W("Mist")], [], [], []);
    expect(words(c.words)).toEqual(["Gust", "Mist"]);
    expect(c.words[0].category).toBe("Weather");
  });
  it("words: an antonym naming another word becomes an opposite both ways", () => {
    const c = buildCatalog([W("Drizzle", "Weather", { antonyms: ["Downpour"] }), W("Downpour")], [], [], []);
    expect(c.words.map((w) => w.opposite)).toEqual(["Downpour", "Drizzle"]);
  });
  it("grammar rules and challenges: one per id, the first wins, none without an id; challenges that are not a list count as none", () => {
    const c = buildCatalog([], [{ id: "g1", n: 1 }, { id: "g1", n: 2 }, { id: "" }, { id: "g2" }], [null, { id: "c1", n: 1 }, { id: "c1", n: 2 }, {}], []);
    expect(c.grammar).toEqual([{ id: "g1", n: 1 }, { id: "g2" }]);
    expect(c.challenges).toEqual([{ id: "c1", n: 1 }]);
    for (const odd of [undefined, null, "x", {}]) expect(buildCatalog([], [], odd, []).challenges).toEqual([]);
  });
  it("levels: one per name in the order, kept as given; words, then rules, then challenges; other categories in none", () => {
    const order = ["Climate", "Weather", "Empty"];
    const c = buildCatalog([W("Gust"), W("Humid", "Climate"), W("Concierge", "Hotel"), W("Mist")], [{ id: "g1", category: "Weather" }], [{ id: "c1", category: "Weather" }], order);
    expect(c.levelOrder).toBe(order);
    expect(c.levels.map((l) => [l.id, l.title, l.items.map((it) => `${it.kind}:${it.obj.word || it.obj.id}`)])).toEqual([
      ["cat-Climate", "Climate", ["word:Humid"]],
      ["cat-Weather", "Weather", ["word:Gust", "word:Mist", "grammar:g1", "challenge:c1"]],
      ["cat-Empty", "Empty", []],
    ]);
    expect(c.levels[1].items[0].obj).toBe(c.words[0]);
  });
  it("badges: one per level (same id as the level), then the four fixed ones", () => {
    const c = buildCatalog([W("Gust")], [], [], ["Weather", "Empty"]);
    expect(c.badges.map((b) => `${b.id}|${b.type}|${b.label}|${b.category ?? b.threshold ?? ""}`)).toEqual([
      "cat-Weather|category|Weather Files Closed|Weather",
      "cat-Empty|category|Empty Files Closed|Empty",
      "streak-5|streak|Warming Up|5",
      "streak-10|streak|On a Roll|10",
      "streak-20|streak|Unstoppable|20",
      "completionist|completionist|Full Case Archive|",
    ]);
    expect(badgesFor([])).toHaveLength(4);
  });
  it("does not change the lists it is given", () => {
    const given = [W("Gust"), W("gust")], grammar = [{ id: "g1" }, { id: "g1" }];
    const before = JSON.stringify([given, grammar]);
    buildCatalog(given, grammar, [], ["Weather"]);
    expect(JSON.stringify([given, grammar])).toBe(before);
  });
  it("buildLevel takes the lists it reads", () => {
    expect(buildLevel("Weather", [W("Gust")], [], []).items.map((it) => it.obj.word)).toEqual(["Gust"]);
  });
});

describe("mergeCustomData keeps the copy in engine/data", () => {
  it("one new copy per call; the old names follow it", () => {
    const before = Data.currentCatalog();
    const order = ["Weather"];
    Data.mergeCustomData([W("Gust"), W("gust")], [{ id: "g1", category: "Weather" }], "x", order);
    const now = Data.currentCatalog();
    expect(now).not.toBe(before);
    expect([Data.WORDS, Data.GRAMMAR, Data.CHALLENGES, Data.LEVEL_ORDER, Data.LEVELS, Data.BADGES]).toEqual([now.words, now.grammar, now.challenges, now.levelOrder, now.levels, now.badges]);
    expect(Data.WORDS).toBe(now.words);
    expect(Data.LEVEL_ORDER).toBe(order);
    expect(words(Data.WORDS)).toEqual(["Gust"]);
    expect(Data.LEVELS[0].items).toHaveLength(2);
    Data.mergeCustomData([], [], [], []);
    expect([Data.WORDS, Data.LEVELS, Data.BADGES.length]).toEqual([[], [], 4]);
  });
});
