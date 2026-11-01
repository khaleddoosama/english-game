import { describe, expect, it } from "vitest";
import { buildTree, flattenTree, matchPasted, moveTargets, searchWords, visibleRows } from "../src/features/library/libraryTree.js";

const flat = [
  { id: "t", parent: null, name: "A1.1", position: 1, words: 0, rules: 0 },
  { id: "m", parent: "t", name: "movies", position: 1, words: 2, rules: 0 },
  { id: "h", parent: "m", name: "horror", position: 1, words: 1, rules: 1 },
  { id: "o", parent: null, name: "other", position: 2, words: 0, rules: 0 },
];

describe("tree", () => {
  it("nests views and counts depth", () => {
    const roots = buildTree(flat);
    expect(roots.map((r) => r.name)).toEqual(["A1.1", "other"]);
    expect(flattenTree(roots).map((n) => `${"-".repeat(n.depth)}${n.name}`)).toEqual(["A1.1", "-movies", "--horror", "other"]);
  });
  it("move targets leave out itself, what is inside it, and places that are too deep", () => {
    const roots = buildTree(flat);
    expect(moveTargets(roots, "m").map((n) => n.id)).toEqual(["t", "o"]);
    expect(moveTargets(roots, "t").map((n) => n.id)).toEqual(["o"]);
    expect(moveTargets(roots, "o").map((n) => n.id)).toEqual(["t", "m", "h"]); // a leaf may go as deep as the 4th level
    const deep = buildTree([...flat, { id: "x", parent: "o", name: "x", position: 1, words: 0, rules: 0 }]);
    expect(moveTargets(deep, "o").map((n) => n.id)).toEqual(["t", "m"]);    // with a view inside it, it can't go under horror
  });
});

describe("folding", () => {
  const rows = flattenTree(buildTree(flat));
  const names = (folded) => visibleRows(rows, new Set(folded)).map((n) => n.name);
  it("nothing folded: every row", () => {
    expect(names([])).toEqual(["A1.1", "movies", "horror", "other"]);
  });
  it("a folded view hides what is inside it, at any depth, and nothing else", () => {
    expect(names(["m"])).toEqual(["A1.1", "movies", "other"]);
    expect(names(["t"])).toEqual(["A1.1", "other"]);              // horror too, two levels down
  });
  it("folds inside a folded view are kept: opening the upper one shows the lower one still folded", () => {
    expect(names(["t", "m"])).toEqual(["A1.1", "other"]);
    expect(names(["m"])).toEqual(["A1.1", "movies", "other"]);    // "t" opened again, "m" still folded
  });
  it("a view with nothing inside has nothing to fold, and the rows are not copied or changed", () => {
    expect(names(["h", "o"])).toEqual(["A1.1", "movies", "horror", "other"]);
    expect(visibleRows(rows, new Set(["t"]))[0]).toBe(rows[0]);
  });
});

const words = [
  { word: "Cast", meaning: "A group of actors" },
  { word: "Cast (to throw)", meaning: "To throw" },
  { word: "Shrink", meaning: "To become smaller" },
  { word: "Reluctant", meaning: "Unwilling to do something" },
];
describe("search", () => {
  it("finds by start first, then inside the word or the meaning", () => {
    expect(searchWords(words, "cast").map((w) => w.word)).toEqual(["Cast", "Cast (to throw)"]);
    expect(searchWords(words, "unwilling").map((w) => w.word)).toEqual(["Reluctant"]);
    expect(searchWords(words, "")).toEqual([]);
  });
});

describe("pasted list", () => {
  it("matches exact words, flags a word with several meanings, lists the rest as missing", () => {
    const r = matchPasted("Reluctant\nshrink, cast\nNonsense word", words);
    expect(r.matched).toEqual(["Reluctant", "Shrink"]);
    expect(r.ambiguous).toEqual([{ token: "cast", options: ["Cast", "Cast (to throw)"] }]);
    expect(r.missing).toEqual(["Nonsense word"]);
  });
  it("an exact sense is just that sense", () => {
    expect(matchPasted("Cast (to throw)", words).matched).toEqual(["Cast (to throw)"]);
  });
  it("repeats are counted once", () => {
    expect(matchPasted("Shrink\nshrink", words).matched).toEqual(["Shrink"]);
  });
});
