import { describe, expect, it } from "vitest";
import { mergeQuery, parseRoute, pathFor, readQuery } from "../src/lib/router.js";
import { parseSort } from "../src/features/admin/DataTable.jsx";

describe("routes", () => {
  it("maps paths to screens", () => {
    expect(parseRoute("/")).toEqual({ screen: "levels", section: "practice" });
    expect(parseRoute("/stories")).toEqual({ screen: "levels", section: "stories" });
    expect(parseRoute("/live/ab12cd")).toEqual({ screen: "live", code: "AB12CD" });
    expect(parseRoute("/live")).toEqual({ screen: "live", code: null });
    expect(parseRoute("/admin")).toEqual({ screen: "admin", section: "overview", item: null });
    expect(parseRoute("/admin/words")).toEqual({ screen: "admin", section: "words", item: null });
    expect(parseRoute("/admin/words/Ice%20cream")).toEqual({ screen: "admin", section: "words", item: "Ice cream" });
    expect(parseRoute("/stats").screen).toBe("stats");
    expect(parseRoute("/nope").screen).toBe("notFound");
  });

  it("builds paths that parse back to the same place", () => {
    for (const [screen, extra] of [["levels", {}], ["levels", { section: "stories" }], ["live", { code: "AB12CD" }], ["admin", {}], ["admin", { section: "words", item: "Ice cream" }], ["settings", {}], ["data", {}]]) {
      const route = parseRoute(pathFor(screen, extra));
      expect(route.screen).toBe(screen);
      if (extra.section) expect(route.section).toBe(extra.section);
      if (extra.item) expect(route.item).toBe(extra.item);
      if (extra.code) expect(route.code).toBe(extra.code);
    }
    expect(pathFor("session")).toBe("/play");
    expect(pathFor("speedResults")).toBe("/play");
  });

  it("survives malformed escapes in a pasted link", () => {
    expect(parseRoute("/admin/words/100%").item).toBe("100%");
  });
});

describe("query strings", () => {
  it("sets, replaces and removes parameters", () => {
    expect(mergeQuery("", { hasPicture: true })).toBe("?hasPicture=true");
    expect(mergeQuery("?hasPicture=true&page=3", { page: null })).toBe("?hasPicture=true");
    expect(mergeQuery("?q=pet", { q: "" })).toBe("");
    expect(mergeQuery("?a=1", { b: "x y" })).toBe("?a=1&b=x+y");
  });
  it("keeps false (a real filter value) but drops defaults", () => {
    expect(mergeQuery("", { hasPicture: false })).toBe("?hasPicture=false");
    expect(mergeQuery("?status=resolved", { status: "open" }, { status: "open" })).toBe("");
    expect(mergeQuery("", { range: 30 }, { range: "30" })).toBe("");
  });
  it("reads parameters", () => {
    expect(readQuery("?hasPicture=true&q=a%20b")).toEqual({ hasPicture: "true", q: "a b" });
  });
  it("encodes table sorting", () => {
    expect(parseSort("-score")).toEqual({ key: "score", dir: "desc" });
    expect(parseSort("word")).toEqual({ key: "word", dir: "asc" });
    expect(parseSort("none", { key: "x", dir: "asc" })).toBeNull();
    expect(parseSort(undefined, { key: "x", dir: "asc" })).toEqual({ key: "x", dir: "asc" });
  });
});
