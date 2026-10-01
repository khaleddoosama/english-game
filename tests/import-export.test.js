// Import & export: reading and checking files (including broken ones),
// which modes a player or the admin may apply, and round trips through
// the export formats.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { importModeError, importModes, inspectImport, isBackupFile, wordsCsv } from "../src/features/data/transfer";

const backupText = readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8");
const backup = JSON.parse(backupText);
const current = V2.withoutRemovedFields(backup);
const contentFile = V2.contentOnly(current);

const failure = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected the import to be refused"); };

describe("inspectImport: files it refuses", () => {
  it("an empty file", () => {
    expect(failure(() => inspectImport("", current)).message).toMatch(/empty/);
    expect(failure(() => inspectImport("   \n", current)).message).toMatch(/empty/);
  });

  it("text that isn't JSON, marked so the page can say so", () => {
    const e = failure(() => inspectImport('{ "words": [ ', current));
    expect(e.message).toMatch(/isn't valid JSON/);
    expect(e.json).toBe(true);
    expect(e.issues).toEqual([]);
  });

  it("JSON that isn't an object", () => {
    for (const text of ["[1,2]", "null", "42", '"words"']) {
      expect(failure(() => inspectImport(text, current)).message).toMatch(/isn't a Word Hunter/);
    }
  });

  it("an object with no content in it", () => {
    const e = failure(() => inspectImport(JSON.stringify({ hello: "world" }), current));
    expect(e.issues.join("\n")).toMatch(/no content arrays/);
  });

  it("a word that fails the checks, with the place named", () => {
    const bad = { schemaVersion: 2, kind: "content", words: [{ word: "Broken", category: "X", meaning: "", situation: "x", gap: "no blank", hints: [] }] };
    const e = failure(() => inspectImport(JSON.stringify(bad), current));
    expect(e.message).toMatch(/^\d+ problems? in this file\.$/);
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.issues.some((i) => i.startsWith("words[0]"))).toBe(true);
  });

  it("the same word twice", () => {
    const w = contentFile.words[0];
    const e = failure(() => inspectImport(JSON.stringify({ schemaVersion: 2, kind: "content", words: [w, { ...w }] }), current));
    expect(e.issues.join("\n")).toMatch(/duplicate key/);
  });

  it("player data inside a content file", () => {
    const e = failure(() => inspectImport(JSON.stringify({ ...contentFile, score: 100 }), current));
    expect(e.issues.join("\n")).toMatch(/score: player data is not allowed in content/);
  });

  it("an unknown kind or version", () => {
    expect(failure(() => inspectImport(JSON.stringify({ ...contentFile, kind: "spreadsheet" }), current)).issues.join("\n")).toMatch(/unsupported kind/);
    expect(failure(() => inspectImport(JSON.stringify({ ...contentFile, schemaVersion: 9 }), current)).issues.join("\n")).toMatch(/unsupported version/);
  });

  it("a content list that isn't a list", () => {
    const e = failure(() => inspectImport(JSON.stringify({ schemaVersion: 2, kind: "content", words: { word: "x" } }), current));
    expect(e.issues).toContain("words: expected array");
  });
});

describe("inspectImport: files it accepts", () => {
  it("our own backup: recognised, with its progress, and nothing changes", () => {
    const check = inspectImport(backupText, current);
    expect(check.isBackup).toBe(true);
    expect(check.words).toEqual({ updated: 0, added: 0, unchanged: current.words.length });
    expect(check.grammar.added + check.grammar.updated).toBe(0);
    expect(check.progress.score).toBe(backup.score);
    expect(check.progress.words).toBeGreaterThan(0);
    expect(check.progress.mastered).toBeLessThanOrEqual(check.progress.words);
  });

  it("a backup into an empty game adds everything", () => {
    const check = inspectImport(backupText, {});
    expect(check.words.added).toBe(current.words.length);
    expect(check.words.unchanged).toBe(0);
  });

  it("a content export imports straight back, unchanged", () => {
    const check = inspectImport(JSON.stringify(contentFile), current);
    expect(check.isBackup).toBe(false);
    expect(check.progress).toBeNull();
    expect(check.words.unchanged).toBe(contentFile.words.length);
    expect(check.stories).toBe(contentFile.stories.length);
  });

  it("counts an edited word as updated and a new one as added", () => {
    const words = [{ ...contentFile.words[0], meaning: "Changed meaning." }, { ...contentFile.words[1], word: "Zz brand new" }];
    const check = inspectImport(JSON.stringify({ schemaVersion: 2, kind: "content", words }), current);
    expect(check.words).toEqual({ updated: 1, added: 1, unchanged: 0 });
  });

  it("an old backup without a kind is still a backup", () => {
    const { kind, ...old } = backup;
    expect(kind).toBe("backup");
    expect(isBackupFile(old)).toBe(true);
    expect(inspectImport(JSON.stringify(old), current).isBackup).toBe(true);
  });
});

describe("import modes", () => {
  const backupCheck = inspectImport(backupText, current);
  const contentCheck = inspectImport(JSON.stringify(contentFile), current);

  it("the admin can apply a backup three ways, content first", () => {
    expect(importModes(backupCheck, true)).toEqual(["content", "full", "progress"]);
  });
  it("a content file has no progress to restore", () => {
    expect(importModes(contentCheck, true)).toEqual(["content"]);
    expect(importModeError(contentCheck, "full", true)).toMatch(/no progress/);
    expect(importModeError(contentCheck, "progress", true)).toMatch(/no progress/);
  });
  it("a player may only restore their own progress", () => {
    expect(importModes(backupCheck, false)).toEqual(["progress"]);
    expect(importModeError(backupCheck, "content", false)).toMatch(/Only the admin/);
    expect(importModeError(backupCheck, "full", false)).toMatch(/Only the admin/);
    expect(importModeError(backupCheck, "progress", false)).toBeNull();
  });
  it("a player gets no mode at all for a content file", () => {
    expect(importModes(contentCheck, false)).toEqual([]);
  });
  it("an unknown mode is refused", () => {
    expect(importModeError(backupCheck, "everything", true)).toMatch(/Unknown import mode/);
  });
});

describe("words spreadsheet", () => {
  const parseCsv = (text) => {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
      else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows;
  };

  it("has a header, one row per word and a BOM for Excel", () => {
    const csv = wordsCsv(current.words);
    expect(csv.startsWith("﻿word,type,category")).toBe(true);
    expect(parseCsv(csv.slice(1)).length).toBe(current.words.length + 1);
  });

  it("quotes commas, quotes and new lines so every row keeps its columns", () => {
    const tricky = [{ word: 'Say "hi"', meaning: "one, two", situation: "line one\nline two", hints: ["a", "b"], synonyms: [] }];
    const rows = parseCsv(wordsCsv(tricky).slice(1));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(rows[0].length);
    const col = (name) => rows[1][rows[0].indexOf(name)];
    expect(col("word")).toBe('Say "hi"');
    expect(col("meaning")).toBe("one, two");
    expect(col("situation")).toBe("line one\nline two");
    expect(col("hints")).toBe("a | b");
    expect(col("image")).toBe("");
  });

  it("an empty game gives just the header", () => {
    expect(wordsCsv([])).toBe("﻿word,type,category,subCategory,meaning,situation,gap,hints,synonyms,antonyms,collocations,image");
  });
});
