// The shape of src/: no loops between files, no loops between modules, and
// the library module stays out of any loop. Two loops and one upward import
// exist today and are listed as known debts (docs/architecture/modules.md,
// "Plan"); this test fails when a new one appears, and also when a listed one
// is fixed, so the list can only get shorter.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SRC, cycles, fileGraph, key, moduleGraph, walk } from "./importGraph.js";

const graph = fileGraph();
const modules = moduleGraph(graph);

describe("no new loops between files", () => {
  it("none", () => {
    expect(cycles(graph)).toEqual([]);
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

  it("question reports are in no loop and use only the engine; the app shell reaches them through their index", () => {
    expect(cycles(modules).flat()).not.toContain("features/reports");
    expect(modules["features/reports"]).toEqual(["engine"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/reports/") && tos.some((t) => t.startsWith("features/reports/") && t !== "features/reports/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("content admin is in no loop and uses only the engine; the app shell reaches it through its index", () => {
    expect(cycles(modules).flat()).not.toContain("features/content-admin");
    expect(modules["features/content-admin"]).toEqual(["engine"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/content-admin/") && tos.some((t) => t.startsWith("features/content-admin/") && t !== "features/content-admin/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("import & export is in no loop and uses only the engine and styles; the rest of the app reaches it through its index or its screen", () => {
    expect(cycles(modules).flat()).not.toContain("features/data");
    expect(modules["features/data"]).toEqual(["engine", "styles"]);
    const doors = ["features/data/index", "features/data/ImportExport"];
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/data/") && tos.some((t) => t.startsWith("features/data/") && !doors.includes(t)));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("the admin panel is in no loop, depends only on what the module document lists, and is reached only through AdminPanel", () => {
    expect(cycles(modules).flat()).not.toContain("features/admin");
    expect(modules["features/admin"]).toEqual(["engine", "features/data", "features/media", "lib", "styles"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/admin/") && tos.some((t) => t.startsWith("features/admin/") && t !== "features/admin/AdminPanel"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("the shell's AI helpers are in no loop, use only the engine, media and lib, and are reached through their index", () => {
    expect(cycles(modules).flat()).not.toContain("features/ai-helpers");
    expect(modules["features/ai-helpers"]).toEqual(["engine", "features/media", "lib"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/ai-helpers/") && tos.some((t) => t.startsWith("features/ai-helpers/") && t !== "features/ai-helpers/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("loading and saving the content is in no loop, uses only the engine and lib, and is reached through its index", () => {
    expect(cycles(modules).flat()).not.toContain("features/content");
    expect(modules["features/content"]).toEqual(["engine", "lib"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/content/") && tos.some((t) => t.startsWith("features/content/") && t !== "features/content/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("the dictionary rules import nothing (pure), and the rest of the app reaches them through V2", () => {
    expect(graph["engine/dictionary"]).toEqual([]);
    const importers = Object.entries(graph).filter(([, tos]) => tos.includes("engine/dictionary")).map(([file]) => file);
    expect(importers).toEqual(["engine/v2"]);
  });

  it("the game's copy of the content is built with no state (only V2), and only engine/data keeps it", () => {
    expect(graph["engine/catalog"]).toEqual(["engine/v2"]);
    const importers = Object.entries(graph).filter(([, tos]) => tos.includes("engine/catalog")).map(([file]) => file);
    expect(importers).toEqual(["engine/data"]);
  });

  it("the question, progress and AI engine take the content as an argument: they import none of the content variables", () => {
    const CONTENT = ["WORDS", "GRAMMAR", "CHALLENGES", "LEVEL_ORDER", "LEVELS", "BADGES"];
    for (const file of ["questions", "progress", "ai"]) {
      const text = readFileSync(new URL(`../src/engine/${file}.js`, import.meta.url), "utf8");
      const imported = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/data"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
      expect(imported.filter((name) => CONTENT.includes(name)), file).toEqual([]);
    }
  });

  it("outside the engine, only the content module reaches the game's copy (engine/data's variables, currentCatalog, mergeCustomData)", () => {
    const GUARDED = ["WORDS", "GRAMMAR", "CHALLENGES", "LEVEL_ORDER", "LEVELS", "BADGES", "currentCatalog", "mergeCustomData"];
    const offenders = [];
    for (const path of walk(SRC).filter((p) => /\.jsx?$/.test(p))) {
      const file = key(path);
      if (file.startsWith("engine/") || file.startsWith("features/content/")) continue;
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[./]*engine\/data"/g)) {
        for (const name of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0])) if (GUARDED.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the engine is below the features: its one import of a feature is the known debt (engine/data uses media's checkImageLinks)", () => {
    expect(modules.engine).toEqual(["features/media", "lib"]);
  });

  it("nothing but the app shell imports the app shell, and features do not import the app", () => {
    for (const [from, tos] of Object.entries(modules)) {
      if (from !== "main") expect(tos, from).not.toContain("app");
    }
  });
});
