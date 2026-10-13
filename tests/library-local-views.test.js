import { describe, expect, it } from "vitest";
import { activeKeys, childrenOf, depthOf, descendantIds, descendants, emptyDb, findView, heightBelow, liveViews, nameTaken, pathFor, summaryOf } from "../src/features/library/local/localViews.js";
import { MSG, NAME_ERROR, cleanViewName, validViewName } from "../src/features/library/libraryRules.js";
import { LibraryError, friendlyError } from "../src/features/library/libraryErrors.js";

const view = (id, parent, name, path, extra = {}) => ({ id, parent, name, path, position: 1, senses: {}, rules: {}, ...extra });
const db = () => ({ ...emptyDb(), views: [
  view("a", null, "A1.1", "A1.1", { senses: { w1: { at: 1 }, w2: { at: 1, removed: true } }, rules: { g1: { at: 1 } } }),
  view("b", "a", "movies", "A1.1::movies"),
  view("c", "b", "horror", "A1.1::movies::horror"),
  view("d", null, "other", "other"),
  view("x", "a", "gone", "A1.1::gone", { removed: true }),
] });

describe("local view helpers", () => {
  it("live views leave out the removed ones", () => {
    expect(liveViews(db()).map((v) => v.id)).toEqual(["a", "b", "c", "d"]);
    expect(findView(db(), "x")).toBeUndefined();
  });
  it("children, descendants and depth", () => {
    expect(childrenOf(db(), "a").map((v) => v.id)).toEqual(["b"]);
    expect(descendantIds(db(), "a")).toEqual(["b", "c"]);
    expect(descendants(db(), findView(db(), "a")).map((v) => v.id)).toEqual(["b", "c"]);
    expect([depthOf(db(), "a"), depthOf(db(), "c"), depthOf(db(), "nope")]).toEqual([1, 3, 0]);
    expect([heightBelow(db(), "a"), heightBelow(db(), "c"), heightBelow(db(), "d")]).toEqual([2, 0, 0]);
  });
  it("paths and name clashes (any case, same parent only)", () => {
    expect(pathFor(db(), null, "z")).toBe("z");
    expect(pathFor(db(), "b", "z")).toBe("A1.1::movies::z");
    expect(nameTaken(db(), "a", "MOVIES")).toBe(true);
    expect(nameTaken(db(), null, "movies")).toBe(false);
    expect(nameTaken(db(), "a", "movies", "b")).toBe(false);   // renaming itself
  });
  it("what is in, not taken out", () => {
    expect(activeKeys(db().views[0].senses)).toEqual(["w1"]);
    expect(activeKeys(undefined)).toEqual([]);
    expect(summaryOf(db().views[0])).toEqual({ words: 1, rules: 1 });
  });
});

describe("the shared rules", () => {
  it("view names", () => {
    expect(cleanViewName("  x ")).toBe("x");
    expect([validViewName(""), validViewName("a::b"), validViewName("a".repeat(61)), validViewName("a".repeat(60)), validViewName(null)]).toEqual([false, false, false, true, false]);
    expect(MSG.badName).toEqual([NAME_ERROR, "22023"]);
    expect(MSG.nameTaken("x")[0]).toContain('"x"');
    expect(MSG.shareNoRoom(3)[0]).toContain("3 more views");
  });
  it("errors: a LibraryError stays, a dropped connection says offline, anything else keeps its message and code", () => {
    const own = new LibraryError("x", "P0002");
    expect(friendlyError(own)).toBe(own);
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatchObject({ code: "offline" });
    expect(friendlyError({ message: "boom", code: "22023" })).toMatchObject({ message: "boom", code: "22023" });
    expect(friendlyError("plain")).toMatchObject({ message: "plain" });
  });
});
