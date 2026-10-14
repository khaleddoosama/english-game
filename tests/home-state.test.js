// What Home shows, decided without any screen: the open tab, the tabs, and what a player who only sees their own library gets.
import { describe, expect, it } from "vitest";
import { describeItems, homeTabs, inLibrary, itemsScope, limitLessons, resolveHomeView } from "../src/features/home/homeState.js";

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
