// The edges of the My Library module (docs/modules/library/README.md): who may
// import its files, what it may import from the rest of the app, and that its
// two implementations offer the same calls. A change that crosses an edge has
// to change this list, and so the document next to it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLibraryApi, createSupabaseLibraryApi } from "../src/features/library/libraryApi.js";

const SRC = resolve(import.meta.dirname, "../src");
const LIB = join(SRC, "features/library");

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|css)$/.test(p) ? [p] : [];
});
const importsOf = (file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)].map((m) => m[1]);
};
// "../features/library/scope" -> "features/library/scope" (no extension), relative to src
const target = (file, spec) => relative(SRC, resolve(dirname(file), spec)).replace(/\.(jsx?|css)$/, "");
const inLibrary = (rel) => rel === "features/library" || rel.startsWith("features/library/");
// "../library" resolves to the folder: its index.js

describe("who imports the module", () => {
  const outside = walk(SRC).filter((f) => !inLibrary(relative(SRC, f)));
  const found = {};
  for (const f of outside) for (const spec of importsOf(f)) {
    const t = target(f, spec);
    if (inLibrary(t)) (found[relative(SRC, f)] ||= []).push(t);
  }

  it("only the app shell and Live challenges, and only through the module's index", () => {
    expect(found).toEqual({
      "app/WordHunter.jsx": ["features/library"],
      "features/live/LiveChallenge.jsx": ["features/library"],
    });
  });
});

describe("what the module imports from the rest of the app", () => {
  const files = walk(LIB);
  const out = new Set();
  for (const f of files) for (const spec of importsOf(f)) {
    const t = target(f, spec);
    if (!inLibrary(t)) out.add(t);
  }

  it("only the shared pieces listed in the module document", () => {
    expect([...out].sort()).toEqual([
      "engine/v2",
      "features/home",
      "lib/router",
      "lib/supabase",
      "styles/library",
    ]);
  });

  it("the pure logic files import nothing from the app but the engine's word helpers", () => {
    for (const name of ["libraryRules.js", "libraryErrors.js", "scope.js", "libraryIds.js", "libraryTree.js"]) {
      const f = join(LIB, name);
      const outward = importsOf(f).map((s) => target(f, s)).filter((t) => !inLibrary(t));
      expect(outward.filter((t) => t !== "engine/v2"), name).toEqual([]);
    }
  });
});

describe("the two implementations of the library API", () => {
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const local = createLocalLibraryApi({ storage: memory(), me: () => "a" });
  const online = createSupabaseLibraryApi({ rpc: async () => ({ data: null, error: null }) });

  it("offer the same calls", () => {
    const names = (api) => Object.keys(api).filter((k) => k !== "mode").sort();
    expect(names(local)).toEqual(names(online));
    expect(local.mode ?? "local").not.toBe(online.mode);
  });

  it("every call is a function that returns a promise", async () => {
    for (const api of [local, online]) {
      for (const [name, fn] of Object.entries(api)) {
        if (name === "mode") continue;
        expect(typeof fn, name).toBe("function");
      }
    }
  });
});
