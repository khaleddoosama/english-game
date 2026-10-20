// What Home shows, decided without any screen: the open tab, the tabs, what a player who only sees their own library
// gets, today's goal, the order of the stories, and the Speed Round card. Made-up words and stories.
// Docs: docs/modules/practice/home.md.
import { describe, expect, it } from "vitest";
import { describeItems, goalView, homeTabs, inLibrary, itemsScope, limitLessons, resolveHomeView, speedCard, storyList } from "../src/features/home/homeState.js";

const roots = [{ id: "a", name: "Gateway" }, { id: "b", name: "Unit" }];
const base = { isAdmin: false, libraryReady: true, roots };

describe("resolveHomeView", () => {
  it("By lesson by default and for anything unknown to be shown", () => {
    expect(resolveHomeView({ ...base, levelView: undefined })).toBe("lesson");
    expect(resolveHomeView({ ...base, levelView: "lesson" })).toBe("lesson");
  });
  it("Gateway (course) is the admin's: others fall back to By lesson", () => {
    expect(resolveHomeView({ ...base, isAdmin: true, levelView: "course" })).toBe("course");
    expect(resolveHomeView({ ...base, levelView: "course" })).toBe("lesson");
  });
  it("a biggest view opens while it exists and the library is on; otherwise By lesson", () => {
    expect(resolveHomeView({ ...base, levelView: "view:b" })).toBe("view:b");
    expect(resolveHomeView({ ...base, levelView: "view:gone" })).toBe("lesson");
    expect(resolveHomeView({ ...base, libraryReady: false, levelView: "view:b" })).toBe("lesson");
    expect(resolveHomeView({ ...base, roots: null, levelView: "view:b" })).toBe("view:b");        // not loaded yet: keep it
  });
  it("the old setting 'mine' opens the first biggest view", () => {
    expect(resolveHomeView({ ...base, levelView: "mine" })).toBe("view:a");
    expect(resolveHomeView({ ...base, roots: [], levelView: "mine" })).toBe("lesson");
  });
});

describe("homeTabs", () => {
  it("By lesson, then each biggest view", () => {
    expect(homeTabs(base)).toEqual([["lesson", "By lesson"], ["view:a", "Gateway"], ["view:b", "Unit"]]);
  });
  it("the admin gets the course Gateway first, unless a view of theirs is called Gateway", () => {
    expect(homeTabs({ ...base, isAdmin: true, roots: [] })).toEqual([["course", "Gateway"], ["lesson", "By lesson"]]);
    expect(homeTabs({ ...base, isAdmin: true })[0]).toEqual(["lesson", "By lesson"]);
    expect(homeTabs({ ...base, isAdmin: true, roots: [{ id: "g", name: "GATEWAY" }] }).map((t) => t[0])).toEqual(["lesson", "view:g"]);
  });
  it("no views before the library is on", () => {
    expect(homeTabs({ ...base, libraryReady: false })).toEqual([["lesson", "By lesson"]]);
  });
});

describe("what a player sees of their library", () => {
  const w = (word) => ({ kind: "word", obj: { word } });
  const g = (id) => ({ kind: "grammar", obj: { id } });
  const keys = { words: new Set(["a", "b"]), rules: new Set(["g1"]) };
  it("inLibrary tells a word or rule that is in", () => {
    expect(inLibrary(w("a"), keys)).toBe(true);
    expect(inLibrary(w("z"), keys)).toBe(false);
    expect(inLibrary(g("g1"), keys)).toBe(true);
    expect(inLibrary({ kind: "pun", obj: { id: "p" } }, keys)).toBe(false);
  });
  it("limitLessons cuts each lesson to the library and drops the ones left empty", () => {
    const levels = [{ id: "L1", items: [w("a"), w("z"), g("g1")] }, { id: "L2", items: [w("y")] }];
    expect(limitLessons(levels, keys).map((l) => [l.id, l.items.length])).toEqual([["L1", 2]]);
  });
  it("itemsScope is the words and rules of a list of items", () => {
    const s = itemsScope([w("a"), w("b"), g("g1")]);
    expect([...s.words]).toEqual(["a", "b"]);
    expect([...s.rules]).toEqual(["g1"]);
  });
});

describe("describeItems", () => {
  it("counts words and grammar rules, and says nothing for nothing", () => {
    expect(describeItems([{ kind: "word" }, { kind: "grammar" }, { kind: "grammar" }])).toBe("1 word · 2 grammar rules");
    expect(describeItems([{ kind: "word" }, { kind: "word" }])).toBe("2 words");
    expect(describeItems([])).toBe("");
  });
});

describe("today's goal", () => {
  it("answered of the goal and the accuracy; none before the first answer", () => {
    expect(goalView({ answered: 3, correct: 2 }, 5)).toEqual({ done: false, answered: 3, goal: 5, accuracy: 67, width: 60, bonus: 0 });
    expect(goalView({ answered: 0, correct: 0 }, 20).accuracy).toBe(null);
  });
  it("reached at the goal; the questions past it are a bonus; the bar stops at 100%", () => {
    expect(goalView({ answered: 5, correct: 5 }, 5)).toMatchObject({ done: true, bonus: 0, width: 100 });
    expect(goalView({ answered: 7, correct: 6 }, 5)).toMatchObject({ done: true, bonus: 2, width: 100, accuracy: 86 });
  });
});

describe("the stories", () => {
  const words = ["A", "B", "C"].map((word) => ({ word }));
  const find = (list, w) => list.find((x) => x.word === w) || null;
  const known = (r) => !!r?.known;
  const story = (id, targetWords) => ({ id, targetWords });
  it("fewest new words first (a stable order for equal counts), each with its new words and best result", () => {
    const list = storyList([story("s1", ["A", "B", "C"]), story("s2", ["A"]), story("s3", ["B"])], words, { A: { known: true } }, [{ id: "s1", correct: 2, total: 3 }], find, known);
    expect(list.map((e) => [e.story.id, e.fresh, e.record?.correct ?? null])).toEqual([["s2", 0, null], ["s3", 1, null], ["s1", 2, 2]]);
  });
  it("a target word missing from the content counts as new; the stories given are not reordered", () => {
    const stories = [story("s1", ["Z"]), story("s2", [])];
    expect(storyList(stories, words, {}, [], find, known).map((e) => [e.story.id, e.fresh])).toEqual([["s2", 0], ["s1", 1]]);
    expect(stories.map((st) => st.id)).toEqual(["s1", "s2"]);
  });
});

describe("the Speed Round card", () => {
  it("locked with how many more words to master; then the pool and the bests", () => {
    expect(speedCard(4, 5, 0, 0)).toEqual({ locked: true, text: "Master 1 more word to unlock" });
    expect(speedCard(0, 5, 0, 0).text).toBe("Master 5 more words to unlock");
    expect(speedCard(5, 5, 40, 3)).toEqual({ locked: false, text: "5 mastered words in the pool · best 40 pts, x3 combo" });
  });
});
