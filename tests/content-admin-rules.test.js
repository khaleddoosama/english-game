// Content admin, the pure rules (src/features/content-admin/contentAdminRules.js): what renaming a word, merging
// categories, removing empty levels and the levels editor do to the content and the level order, and how progress
// keys follow a rename. All content is made up. Docs: docs/modules/admin/content-admin.md.
import { describe, expect, it } from "vitest";
import {
  editedLevels, hasRenames, levelIdMap, levelListWithout, mergedCategories, movedKeys, pendingOf,
  renamedClearedLevels, renamedConfusions, renamedWord, withWordFields, withoutEmptyLevels,
} from "../src/features/content-admin/contentAdminRules.js";

const content = () => ({
  words: [
    { word: "Chilly", category: "Weather", meaning: "a bit cold" },
    { word: "Freezing", category: "Weather", meaning: "very cold", opposite: "Chilly" },
    { word: "Lobby", category: "Hotel", meaning: "the hall at the entrance" },
  ],
  grammar: [{ id: "g-1", category: "Hotel", title: "Present perfect" }],
  challenges: [{ id: "c-1", category: "Weather", linkedWords: ["Chilly"] }],
  combos: [{ id: "k-1", category: "Weather", words: ["Chilly", "Freezing"] }],
  stories: [{ id: "s-1", category: "Hotel", targetWords: ["Chilly"], questions: [{ targetWord: "Chilly" }, { targetWords: ["Lobby", "Chilly"] }] }],
});

describe("renaming a word", () => {
  it("replaces the word and every item that points at it follows: other words, combos, stories, challenges", () => {
    const { linked, renames } = renamedWord(content(), "Chilly", { word: "Cool", category: "Weather", meaning: "a bit cold" });
    expect(renames).toEqual({ words: [{ from: "Chilly", to: "Cool" }], categories: [] });
    expect(linked.words.map((w) => w.word)).toEqual(["Cool", "Freezing", "Lobby"]);
    expect(linked.words[1].opposite).toBe("Cool");
    expect(linked.combos[0].words).toEqual(["Cool", "Freezing"]);
    expect(linked.stories[0].targetWords).toEqual(["Cool"]);
    expect(linked.stories[0].questions).toEqual([{ targetWord: "Cool" }, { targetWords: ["Lobby", "Cool"] }]);
    expect(linked.challenges[0].linkedWords).toEqual(["Cool"]);
  });
  it("finds the word whatever its case or spacing, and keeps the new card as given", () => {
    const next = { word: "Cool", category: "Weather", meaning: "changed" };
    const { linked } = renamedWord(content(), "  chilly ", next);
    expect(linked.words[0]).toEqual(next);
  });
  it("does not change the lists it was given", () => {
    const before = content(), copy = structuredClone(before);
    renamedWord(before, "Chilly", { word: "Cool" });
    expect(before).toEqual(copy);
  });
});

describe("a word's fields", () => {
  it("only the matching word gets the patch; its name stays", () => {
    const words = withWordFields(content().words, "lobby", { meaning: "entrance hall" });
    expect(words[2]).toEqual({ word: "Lobby", category: "Hotel", meaning: "entrance hall" });
    expect(words.slice(0, 2)).toEqual(content().words.slice(0, 2));
  });
});

describe("merging categories", () => {
  it("moves every kind of item from the duplicates to the canonical name and leaves no duplicate level", () => {
    const merged = mergedCategories(content(), ["Weather", "Hotel", "Travel"], "Travel", ["Weather", "Hotel"]);
    for (const kind of ["words", "grammar", "challenges", "combos", "stories"]) expect(merged[kind].every((x) => x.category === "Travel")).toBe(true);
    expect(merged.order).toEqual(["Travel"]);
    expect(merged.renames).toEqual({ words: [], categories: [{ from: "Weather", to: "Travel" }, { from: "Hotel", to: "Travel" }] });
  });
  it("a canonical name not in the order takes the place of the first duplicate", () => {
    expect(mergedCategories(content(), ["Intro", "Hotel", "Weather", "End"], "Places", ["Weather", "Hotel"]).order).toEqual(["Intro", "Places", "End"]);
  });
  it("a canonical name already in the order keeps its place", () => {
    expect(mergedCategories(content(), ["Hotel", "Intro", "Weather"], "Weather", ["Hotel"]).order).toEqual(["Intro", "Weather"]);
  });
  it("a canonical name with no duplicate in the order goes at the end", () => {
    expect(mergedCategories(content(), ["Intro"], "Places", ["Hotel"]).order).toEqual(["Intro", "Places"]);
  });
  it("nothing to do when the only duplicate is the canonical name itself", () => {
    expect(mergedCategories(content(), ["Weather"], "Weather", ["Weather"])).toBeNull();
    expect(mergedCategories(content(), ["Weather"], "Weather", [])).toBeNull();
  });
});

describe("removing empty levels", () => {
  it("keeps the levels some item uses, in their order, and counts the rest", () => {
    expect(withoutEmptyLevels(content(), ["Empty", "Hotel", "Weather", "Gone"])).toEqual({ order: ["Hotel", "Weather"], removed: 2 });
  });
  it("a level used only by a story or a grammar rule is not empty", () => {
    const c = { words: [], grammar: [{ id: "g", category: "Rules" }], challenges: [], combos: [], stories: [{ id: "s", category: "Tales" }] };
    expect(withoutEmptyLevels(c, ["Rules", "Tales", "Empty"])).toEqual({ order: ["Rules", "Tales"], removed: 1 });
  });
});

describe("the levels editor", () => {
  const order = ["Weather", "Hotel"];
  it("a level missing from the list is deleted with its items", () => {
    const edited = editedLevels(content(), order, [{ id: "cat-Hotel", title: "Hotel" }]);
    expect(edited.words.map((w) => w.word)).toEqual(["Lobby"]);
    expect(edited.challenges).toEqual([]);
    expect(edited.combos).toEqual([]);
    expect(edited.grammar).toHaveLength(1);
    expect(edited.stories).toHaveLength(1);
    expect(edited.order).toEqual(["Hotel"]);
    expect(edited.renames).toBeNull();
  });
  it("a level whose title changed is renamed: its items move and the rename is reported for progress", () => {
    const edited = editedLevels(content(), order, [{ id: "cat-Weather", title: "Climate" }, { id: "cat-Hotel", title: "Hotel" }]);
    expect(edited.words.filter((w) => w.category === "Climate").map((w) => w.word)).toEqual(["Chilly", "Freezing"]);
    expect(edited.renames).toEqual({ words: [], categories: [{ from: "Weather", to: "Climate" }] });
  });
  it("the order becomes the list's order; titles are trimmed and empty ones dropped", () => {
    const edited = editedLevels(content(), order, [{ id: "cat-Hotel", title: " Hotel " }, { id: "cat-Weather", title: "Weather" }, { id: "cat-x", title: "  " }]);
    expect(edited.order).toEqual(["Hotel", "Weather"]);
  });
  it("deleting one category builds the list without it, so its items go", () => {
    expect(levelListWithout(order, "Weather")).toEqual([{ id: "cat-Hotel", title: "Hotel" }]);
    expect(editedLevels(content(), order, levelListWithout(order, "Weather")).words.map((w) => w.word)).toEqual(["Lobby"]);
  });
});

describe("progress after a rename", () => {
  it("a key moves to the new name; an existing record of the new name is kept and the old one dropped", () => {
    const wmap = new Map([["Chilly", "Cool"], ["Lobby", "Hall"]]);
    expect(movedKeys({ Chilly: { a: 1 }, Lobby: { b: 2 }, Hall: { c: 3 }, Other: { d: 4 } }, wmap)).toEqual({ Cool: { a: 1 }, Hall: { c: 3 }, Other: { d: 4 } });
  });
  it("confusion pairs are renamed on both sides", () => {
    const wmap = new Map([["Chilly", "Cool"]]);
    expect(renamedConfusions({ "Chilly|Freezing": 2, "Lobby|Chilly": 1, "Lobby|Hall": 3 }, wmap)).toEqual({ "Cool|Freezing": 2, "Lobby|Cool": 1, "Lobby|Hall": 3 });
    expect(renamedConfusions(null, wmap)).toEqual({});
  });
  it("category renames move level stats by level id, and cleared levels are renamed once", () => {
    const cmap = levelIdMap([{ from: "Weather", to: "Climate" }, { from: "Hotel", to: "Climate" }]);
    expect(movedKeys({ "cat-Weather": { s: 1 }, "cat-Hotel": { s: 2 } }, cmap)).toEqual({ "cat-Climate": { s: 1 } });
    expect(renamedClearedLevels(["cat-Weather", "cat-Hotel", "cat-Intro"], cmap)).toEqual(["cat-Climate", "cat-Intro"]);
  });
  it("what goes to the server: words first, then categories, each with its kind", () => {
    expect(pendingOf({ words: [{ from: "Chilly", to: "Cool" }], categories: [{ from: "Weather", to: "Climate" }] }))
      .toEqual([{ kind: "word", from: "Chilly", to: "Cool" }, { kind: "category", from: "Weather", to: "Climate" }]);
  });
  it("no renames means nothing to do", () => {
    expect(hasRenames(null)).toBe(false);
    expect(hasRenames({ words: [], categories: [] })).toBe(false);
    expect(hasRenames({ words: [{ from: "a", to: "b" }], categories: [] })).toBe(true);
  });
});
