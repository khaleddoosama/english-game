// Rules of docs/development-workflow.md that hold for the whole repository, on every push:
// - no test is focused (.only) or switched off (.skip / .todo): a skipped test is not a passing test. A suite that
//   needs a service it may not have uses describe.skipIf(!ENV) and says so (docs/integration-tests.md);
// - every relative link in the docs points to a file that exists (a moved or removed file leaves no dead link).
// What the docs say is checked by review, not here.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const walk = (dir, ok) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const path = join(dir, d.name);
  if (d.isDirectory()) return ["node_modules", "out", "dist"].includes(d.name) ? [] : walk(path, ok);
  return ok(d.name) ? [path] : [];
});

function switchedOffTests(source) {
  return [...source.matchAll(/\b(?:it|test|describe)\.(only|skip|todo)\s*\(/g)].map((m) => m[0]);
}

function deadLinks(file, markdown) {
  const text = markdown.replace(/```[\s\S]*?```/g, "");
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
    .filter((url) => !/^(https?:|mailto:|#)/.test(url))
    .filter((url) => { const path = url.split("#")[0]; return path && !existsSync(normalize(join(dirname(file), path))); });
}

describe("tests", () => {
  it("finds focused and switched-off tests, and lets skipIf through", () => {
    expect(switchedOffTests('it.only("a", f); describe.skip("b", f); test.todo("c"); it ("d"); describe.skipIf(!URL)("e", f);')).toEqual(["it.only(", "describe.skip(", "test.todo("]);
  });

  it("none is focused or switched off (use describe.skipIf(!ENV) for a suite that needs a service)", () => {
    const files = [...walk(join(ROOT, "tests"), (n) => /\.(js|jsx)$/.test(n)), ...walk(join(ROOT, "e2e/specs"), (n) => n.endsWith(".cjs"))]
      .filter((f) => f !== join(ROOT, "tests/repo-rules.test.js"));
    const found = files.flatMap((f) => switchedOffTests(readFileSync(f, "utf8")).map((m) => `${relative(ROOT, f)}: ${m}`));
    expect(found).toEqual([]);
  });
});

describe("docs", () => {
  it("finds a link to a missing file, and ignores web links, anchors and code blocks", () => {
    const file = join(ROOT, "docs/README.md");
    expect(deadLinks(file, "[a](architecture/modules.md) [b](missing.md) [c](https://x.y) [d](#top) [e](architecture/modules.md#plan)\n```\n[f](nope.md)\n```")).toEqual(["missing.md"]);
  });

  it("every relative link in the docs points to a file that exists", () => {
    const files = [...walk(join(ROOT, "docs"), (n) => n.endsWith(".md")), ...readdirSync(ROOT).filter((n) => n.endsWith(".md")).map((n) => join(ROOT, n))];
    const found = files.flatMap((f) => deadLinks(f, readFileSync(f, "utf8")).map((u) => `${relative(ROOT, f)}: ${u}`));
    expect(found).toEqual([]);
  });
});
