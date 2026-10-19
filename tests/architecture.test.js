// The shape of src/: no loops between files, no loops between modules, and
// the library module stays out of any loop. Two loops
// exist today and are listed as known debts (docs/architecture/modules.md,
// "Plan"); this test fails when a new one appears, and also when a listed one
// is fixed, so the list can only get shorter.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cycles, fileGraph, moduleGraph } from "./importGraph.js";

const graph = fileGraph();
const modules = moduleGraph(graph);

describe("no new loops between files", () => {
  it("none", () => {
    expect(cycles(graph)).toEqual([]);
  });
});

describe("no new loops between modules", () => {
  it("only the known two: the engine and lib use each other; social and live use each other", () => {
    expect(cycles(modules)).toEqual([["engine", "lib"], ["features/live", "features/social"]]);
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

  it("the content module is in no loop, uses only the engine, media (picture checks) and lib, and is reached through its index", () => {
    expect(cycles(modules).flat()).not.toContain("features/content");
    expect(modules["features/content"]).toEqual(["engine", "features/media", "lib"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/content/") && tos.some((t) => t.startsWith("features/content/") && t !== "features/content/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
  });

  it("the dictionary rules import nothing (pure), and the rest of the app reaches them through V2", () => {
    expect(graph["engine/dictionary"]).toEqual([]);
    const importers = Object.entries(graph).filter(([, tos]) => tos.includes("engine/dictionary")).map(([file]) => file);
    expect(importers).toEqual(["engine/v2"]);
  });

  it("the game's copy of the content is built with no state (only V2); the content module keeps it (engine/data only offers dedupeBy again)", () => {
    expect(graph["engine/catalog"]).toEqual(["engine/v2"]);
    const importers = Object.entries(graph).filter(([, tos]) => tos.includes("engine/catalog")).map(([file]) => file);
    expect(importers).toEqual(["engine/data", "features/content/gameContent"]);
  });

  it("the question, progress and AI engine take the content as an argument: they import none of the content variables", () => {
    const CONTENT = ["WORDS", "GRAMMAR", "CHALLENGES", "LEVEL_ORDER", "LEVELS", "BADGES"];
    for (const file of ["questions", "progress", "ai"]) {
      const text = readFileSync(new URL(`../src/engine/${file}.js`, import.meta.url), "utf8");
      const imported = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/data"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
      expect(imported.filter((name) => CONTENT.includes(name)), file).toEqual([]);
    }
  });

  it("the engine keeps no copy of the content, and only the shell imports the content module (features get the copy passed in)", () => {
    const data = readFileSync(new URL("../src/engine/data.js", import.meta.url), "utf8");
    for (const name of ["WORDS", "GRAMMAR", "CHALLENGES", "LEVEL_ORDER", "LEVELS", "BADGES", "currentCatalog", "mergeCustomData"]) {
      expect(new RegExp(`export\\s+(let|const|function)\\s+${name}\\b`).test(data), name).toBe(false);
    }
    expect(Object.entries(modules).filter(([, tos]) => tos.includes("features/content")).map(([from]) => from)).toEqual(["app"]);
  });

  it("the accounts module is in no loop, uses only lib, and is reached through its index (by the shell and the Profile page)", () => {
    expect(cycles(modules).flat()).not.toContain("features/auth");
    expect(modules["features/auth"]).toEqual(["lib"]);
    const outside = Object.entries(graph).filter(([file, tos]) => !file.startsWith("features/auth/") && tos.some((t) => t.startsWith("features/auth/") && t !== "features/auth/index"));
    expect(outside.map(([file]) => file)).toEqual([]);
    expect(Object.entries(modules).filter(([, tos]) => tos.includes("features/auth")).map(([from]) => from)).toEqual(["app", "features/social"]);
    expect(modules.lib).not.toContain("features/auth");
  });

  it("the engine is below the features: it imports none (the picture check moved to the content module with MT-02)", () => {
    expect(modules.engine).toEqual(["lib"]);
  });

  it("nothing but the app shell imports the app shell, and features do not import the app", () => {
    for (const [from, tos] of Object.entries(modules)) {
      if (from !== "main") expect(tos, from).not.toContain("app");
    }
  });
});
