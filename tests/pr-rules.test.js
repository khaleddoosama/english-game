// The pull-request checks of scripts/pr-rules.mjs (run by .github/workflows/pr-rules.yml), with descriptions that
// pass and descriptions that must fail. Docs: docs/development-workflow.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkedTypes, problems, sections } from "../scripts/pr-rules.mjs";

const TEMPLATE = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
const body = ({ type = "Refactor", why = "Home was inside the shell.", what = "Moved it.", verification = "npx vitest run: all pass.", docs = "Updated: docs/modules/practice/home.md" } = {}) =>
  TEMPLATE.replace(`- [ ] ${type}`, `- [x] ${type}`)
    .replace("## Why\n", `## Why\n${why}\n`)
    .replace("## What changed\n", `## What changed\n${what}\n`)
    .replace("## Verification\n", `## Verification\n${verification}\n`)
    .replace("## Docs\n", `## Docs\n${docs}\n`)
    .replace("## Risks and gaps\n", "## Risks and gaps\nNone.\n");
const failsWith = (b, files, text) => expect(problems(b, files).join("\n")).toMatch(text);

describe("reading the description", () => {
  it("splits it into sections and leaves the template's hints out", () => {
    const s = sections(body());
    expect(s.Why).toBe("Home was inside the shell.");
    expect(s["Risks and gaps"]).toBe("None.");
    expect(sections(TEMPLATE)["Risks and gaps"]).toBe("");
  });

  it("finds the ticked type, upper- or lower-case x", () => {
    expect(checkedTypes(body({ type: "Bug fix" }))).toEqual(["Bug fix"]);
    expect(checkedTypes(TEMPLATE.replace("- [ ] Feature", "- [X] Feature"))).toEqual(["Feature"]);
    expect(checkedTypes(TEMPLATE)).toEqual([]);
  });
});

describe("descriptions that pass", () => {
  it("a refactor with its docs updated", () => {
    expect(problems(body(), ["src/features/home/HomeScreen.jsx", "docs/modules/practice/home.md"])).toEqual([]);
  });

  it("a bug fix with a test, docs not needed for a reason", () => {
    expect(problems(body({ type: "Bug fix", docs: "Not needed: it restores the behaviour the module page already describes." }), ["src/engine/progress.js", "tests/progress-rules.test.js"])).toEqual([]);
  });

  it("a bug fix without a new test when it says why", () => {
    expect(problems(body({ type: "Bug fix", verification: "No new test: the crash needs a real browser tab closing, checked by hand in Chromium.", docs: "Not needed: restores documented behaviour of the save queue." }), ["src/lib/repo.js"])).toEqual([]);
  });

  it("a migration as a data or permissions change, with docs", () => {
    expect(problems(body({ type: "Data or permissions" }), ["supabase/migrations/0044_x.sql", "supabase/tests/x.sql", "docs/modules/live/README.md"])).toEqual([]);
  });

  it("docs or tooling that touches no app code", () => {
    expect(problems(body({ type: "Docs or tooling", docs: "Updated: docs/development-workflow.md" }), [".github/workflows/pr-rules.yml", "docs/development-workflow.md", "AGENTS.md"])).toEqual([]);
  });
});

describe("descriptions that fail", () => {
  it("an empty template", () => {
    const found = problems(TEMPLATE, ["src/a.js"]);
    expect(found.some((p) => p.includes('"## Why" section is empty'))).toBe(true);
    expect(found.some((p) => p.includes("Tick exactly one type"))).toBe(true);
  });

  it("no risks and gaps written", () => {
    failsWith(body().replace("## Risks and gaps\nNone.", "## Risks and gaps"), ["src/a.js", "docs/a.md"], /"## Risks and gaps" section is empty/);
  });

  it("a missing section", () => {
    failsWith(body().replace(/## Verification[\s\S]*?## Docs/, "## Docs"), ["docs/a.md"], /no "## Verification" section/);
  });

  it("two types at once (a refactor mixed with a behaviour change)", () => {
    failsWith(body().replace("- [ ] Bug fix", "- [x] Bug fix"), ["src/a.js", "tests/a.test.js", "docs/a.md"], /exactly one type.*Refactor, Bug fix/);
  });

  it("docs or tooling that changes app code", () => {
    failsWith(body({ type: "Docs or tooling" }), ["src/app/App.jsx", "docs/a.md"], /changes no app code.*src\/app\/App.jsx/);
  });

  it("a migration under any other type", () => {
    failsWith(body({ type: "Feature" }), ["supabase/migrations/0044_x.sql", "tests/a.test.js", "docs/a.md"], /must be "Data or permissions"/);
    failsWith(body({ type: "Refactor" }), ["supabase/rollback/0044_down.sql", "docs/a.md"], /must be "Data or permissions"/);
  });

  it("a bug fix with no test and no reason, or a reason too thin", () => {
    failsWith(body({ type: "Bug fix", docs: "Not needed: restores documented behaviour of the save queue." }), ["src/lib/repo.js"], /needs a test/);
    failsWith(body({ type: "Bug fix", verification: "No new test: n/a", docs: "Not needed: restores documented behaviour of the save queue." }), ["src/lib/repo.js"], /needs a test/);
  });

  it("docs said to be updated with no doc in the diff", () => {
    failsWith(body(), ["src/features/home/HomeScreen.jsx"], /says Updated, but no documentation file changed/);
  });

  it("docs not needed without a reason, or for a feature", () => {
    failsWith(body({ docs: "Not needed: n/a" }), ["src/a.js"], /needs a reason/);
    failsWith(body({ type: "Feature", docs: "Not needed: it is a small button only." }), ["src/a.js", "tests/a.test.js"], /update the module's docs/);
  });

  it("a docs line that is neither Updated nor Not needed", () => {
    failsWith(body({ docs: "See the code." }), ["src/a.js"], /start with "Updated:"/);
  });
});
