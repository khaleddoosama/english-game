// The repeated content and UI rules, as checks: scripts/validate-content.mjs on
// synthetic files, and "English only" for the UI source. No real player data.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { inspectImport } from "../src/features/data/transfer";
import { checkContent } from "../scripts/validate-content.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const engine = { V2, inspectImport };

const word = (over = {}) => ({
  id: "lobby", word: "Lobby", type: "vocab", category: "travel", level: "A2.1", meaning: "The big room at the entrance of a hotel.",
  situations: ["We waited for our friends in the hotel lobby."], gaps: ["We waited for our friends in the hotel ______."],
  hints: ["It is near the front door."], units: ["At the hotel"], ...over,
});
const file = (words, extra = {}) => JSON.stringify({ schemaVersion: 3, kind: "content", categories: [{ id: "travel", title: "Travel" }], words, ...extra });
const run = (words, extra) => checkContent(file(words, extra), engine);
const errorsOf = (words, extra) => run(words, extra).errors.join("\n");

describe("validate-content: what passes", () => {
  it("a clean word", () => {
    const { errors } = run([word()]);
    expect(errors).toEqual([]);
  });

  it("a headword with a bracket keeps its base text in the blank", () => {
    const { errors } = run([word({ id: "cast-throw", word: "Cast (to throw)", meaning: "To throw something.", situations: ["He cast the net into the water."], gaps: ["He ______ the net into the water."] })]);
    expect(errors).toEqual([]);
  });

  it("every file in imports/ is clean", () => {
    const dir = join(ROOT, "imports");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      expect({ f, errors: checkContent(readFileSync(join(dir, f), "utf8"), engine).errors }).toEqual({ f, errors: [] });
    }
  });
});

describe("validate-content: gap sentences", () => {
  it("two blanks", () => {
    expect(errorsOf([word({ gaps: ["We met in the ______ and then in the ______."] })])).toMatch(/exactly one blank.*found 2/);
  });

  it("no blank at all", () => {
    expect(errorsOf([word({ gaps: ["We waited in the hotel."] })])).toMatch(/exactly one blank.*found 0/);
  });

  it("an ending stuck to the blank (the game compares the base form only)", () => {
    expect(errorsOf([word({ gaps: ["Two ______s were full of guests."] })])).toMatch(/attached to the blank/);
    expect(errorsOf([word({ gaps: ["They were ______ing at the front desk."] })])).toMatch(/attached to the blank/);
  });

  it("the headword written next to the blank gives the answer away", () => {
    expect(errorsOf([word({ gaps: ["The lobby is a big room, so we wait in the ______."] })])).toMatch(/already contains "lobby"/);
  });

  it("punctuation next to the blank is fine", () => {
    expect(errorsOf([word({ gaps: ["Where is the ______?", "\"______!\" she said."] })])).toBe("");
  });
});

describe("validate-content: new-content rules", () => {
  it("puns are refused", () => {
    expect(errorsOf([word()], { puns: [{ id: "p1", setup: "x", punchline: "y" }] })).toMatch(/No puns in new content/);
  });

  it("Arabic in content is refused, at the path where it sits", () => {
    expect(errorsOf([word({ hints: ["قريب من الباب"] })])).toMatch(/words\[0\]\.hints\[0\].*Arabic/);
  });

  it("Arabic in a backup's player reports is not content", () => {
    expect(errorsOf([word()], { kind: "backup", mastery: {}, reports: [{ reason: "سؤال غير واضح" }] })).not.toMatch(/Arabic/);
  });

  it("the same word twice in one file", () => {
    expect(errorsOf([word(), word({ id: "lobby-2" })])).toMatch(/"Lobby" appears twice/);
  });

  it("the game's own check still speaks: a missing field is an error", () => {
    expect(errorsOf([word({ meaning: "" })])).toMatch(/meaning/);
  });

  it("text that isn't JSON", () => {
    expect(checkContent("{ nope", engine).errors[0]).toMatch(/not valid JSON/);
  });
});

describe("validate-content: the hook", () => {
  const hook = (input) => spawnSync(process.execPath, ["scripts/validate-content.mjs", "--hook"], { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" });

  it("ignores files outside imports/", () => {
    expect(hook({ tool_input: { file_path: join(ROOT, "src/app/App.jsx") } }).status).toBe(0);
    expect(hook({ tool_input: { file_path: join(ROOT, "word-hunter-backup.json") } }).status).toBe(0);
  });

  it("exits 2 with the problems on stderr for a bad imports/ file, 0 for a good one", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "wh-hook-")), "imports");
    mkdirSync(dir);
    writeFileSync(join(dir, "bad.json"), file([word({ gaps: ["Two ______ here and ______ there."] })]));
    writeFileSync(join(dir, "good.json"), file([word()]));
    const bad = hook({ tool_input: { file_path: join(dir, "bad.json") } });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/exactly one blank/);
    expect(hook({ tool_input: { file_path: join(dir, "good.json") } }).status).toBe(0);
  });
});

describe("UI: English only", () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|css|html)$/.test(n) ? [p] : [];
  });

  it("no Arabic characters in the app source, except the regexes that detect them", () => {
    const hits = [];
    for (const f of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "api")), join(ROOT, "index.html")]) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!/[؀-ۿ]/.test(line)) return;
        if (/(ARABIC\s*=\s*\/\[|\/\[.-.\]\/\.test)/.test(line)) return; // the English-only checks themselves
        hits.push(`${f.slice(ROOT.length)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
