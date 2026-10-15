// The shape of src/: no loops between files, no loops between modules, and
// the library module stays out of any loop. Three loops and one upward import
// exist today and are listed as known debts (docs/architecture/modules.md,
// "Plan"); this test fails when a new one appears, and also when a listed one
// is fixed, so the list can only get shorter.
import { describe, expect, it } from "vitest";
import { cycles, fileGraph, moduleGraph } from "./importGraph.js";

const graph = fileGraph();
const modules = moduleGraph(graph);

describe("no new loops between files", () => {
  it("only the known one", () => {
    expect(cycles(graph)).toEqual([["engine/ai", "engine/questions"]]);
  });
});

describe("no new loops between modules", () => {
  it("only the known two: the engine, media and lib use each other; social and live use each other", () => {
    expect(cycles(modules)).toEqual([["engine", "features/media", "lib"], ["features/live", "features/social"]]);
  });

  it("My Library is in none, and depends only on what the module document lists", () => {
    expect(cycles(modules).flat()).not.toContain("features/library");
    expect(modules["features/library"]).toEqual(["engine", "features/home", "lib", "styles"]);
  });

  it("the engine is below the features: its one import of a feature is the known debt (engine/ai uses media)", () => {
    expect(modules.engine).toEqual(["features/media", "lib"]);
  });

  it("nothing but the app shell imports the app shell, and features do not import the app", () => {
    for (const [from, tos] of Object.entries(modules)) {
      if (from !== "main") expect(tos, from).not.toContain("app");
    }
  });
});
