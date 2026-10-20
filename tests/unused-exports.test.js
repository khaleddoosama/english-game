// Every named export in src/ is used somewhere else: in another source file, a test, a browser spec, the API, the
// database scripts, or as a property (V2.findWord counts for findWord). An export nobody reads is either dead code or
// should not be exported. Names are matched as whole identifiers, so a mention in a string or a comment also counts:
// the check can miss a dead export, never call a used one dead. Default exports are not checked.
// Docs: docs/architecture/unused-exports.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
// The reference copy in legacy/ and the data in imports/ are not code; e2e/out holds screenshots.
const SEARCHED = ["src", "tests", "e2e", "api", "supabase", "public"];
const SKIP = new Set(["node_modules", "dist", "out"]);
const CODE = /\.(js|jsx|cjs|mjs|sh|sql|html)$/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return SKIP.has(d.name) ? [] : walk(path);
    return CODE.test(d.name) && statSync(path).size < 2_000_000 ? [path] : [];
  });
}

// This file is left out: its own words would count as uses.
const files = [...SEARCHED.flatMap((d) => walk(join(ROOT, d))), ...["vite.config.js", "index.html", "eslint.config.js"].map((f) => join(ROOT, f))]
  .filter((f) => f !== join(ROOT, "tests/unused-exports.test.js"));
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const identifiers = new Map([...text].map(([f, t]) => {
  const counts = new Map();
  for (const id of t.match(/[A-Za-z_$][\w$]*/g) || []) counts.set(id, (counts.get(id) || 0) + 1);
  return [f, counts];
}));

function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // export { a, b as c } (not a re-export "from" another file: that line is a use of the names)
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name && name !== "default") names.add(name);
    }
  }
  return names;
}

function unusedExports() {
  const found = [];
  for (const [file, source] of text) {
    if (!file.startsWith(join(ROOT, "src")) || !/\.jsx?$/.test(file)) continue;
    for (const name of exportedNames(source)) {
      const usedElsewhere = [...identifiers].some(([other, counts]) => other !== file && counts.has(name));
      if (!usedElsewhere) found.push(`${relative(ROOT, file)}: ${name}`);
    }
  }
  return found.sort();
}

describe("exports in src", () => {
  it("finds the names a file exports", () => {
    expect([...exportedNames([
      "export function a() {}", "export async function b() {}", "export const c = 1;", "export let d;", "export class E {}",
      "export { f, g as h };", "export { i } from \"./x\";", "export default function j() {}", "const k = 1;",
    ].join("\n"))]).toEqual(["a", "b", "c", "d", "E", "f", "h"]);
  });

  it("every named export is used outside its own file", () => {
    expect(unusedExports()).toEqual([]);
  });
});
