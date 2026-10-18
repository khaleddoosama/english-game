// Import & export, the steps with no state (src/features/data/importPlan.js): the files an export makes, what
// applying a checked file does to the content and the level order in each mode, renames in a v3 file, and the
// progress a backup brings back. All content is made up. Docs: docs/modules/admin/import-export.md.
import { describe, expect, it } from "vitest";
import { contentImportPlan, exportFileOf, importDoneText, restoredProgressOf } from "../src/features/data/importPlan.js";

const word = (w, category, extra = {}) => ({
  word: w, type: "vocab", category, meaning: `The meaning of ${w}.`, partsOfSpeech: ["noun"],
  situation: `We talked about the ${w} on the way home.`, gap: "We talked about the ______ on the way home.", ...extra,
});
const contentFile = (words, extra = {}) => ({ schemaVersion: 2, kind: "content", words, grammar: [], challenges: [], combos: [], stories: [], ...extra });
const live = (words) => ({ words, grammar: [], challenges: [], combos: [], stories: [], note: "old note" });
const names = (plan) => plan.content.words.map((w) => `${w.word}:${w.category}`).sort();

const NOW = new Date("2026-10-18T09:30:00.000Z");

describe("the files an export makes", () => {
  it("a backup: dated name, one line of JSON with who and when", () => {
    const file = exportFileOf("backup", { backup: { kind: "backup", score: 40 }, exportedBy: "local" }, NOW);
    expect(file.name).toBe("word-hunter-backup-2026-10-18.json");
    expect(file.type).toBe("application/json");
    expect(file.text).not.toContain("\n");
    expect(JSON.parse(file.text)).toEqual({ kind: "backup", score: 40, exportedAt: "2026-10-18T09:30:00.000Z", exportedBy: "local" });
  });
  it("content: dated name, indented JSON of the content only (no progress)", () => {
    const file = exportFileOf("content", { content: { ...live([word("Ferry", "Travel")]), mastery: { Ferry: {} } } }, NOW);
    expect(file.name).toBe("word-hunter-content-2026-10-18.json");
    expect(file.text).toContain("\n  ");
    const parsed = JSON.parse(file.text);
    expect(parsed.words.map((w) => w.word)).toEqual(["Ferry"]);
    expect(parsed.mastery).toBeUndefined();
  });
  it("the words spreadsheet: dated csv with a header and a row per word", () => {
    const file = exportFileOf("wordsCsv", { words: [word("Ferry", "Travel"), word("Harbour", "Travel")] }, NOW);
    expect(file.name).toBe("word-hunter-words-2026-10-18.csv");
    expect(file.type).toBe("text/csv;charset=utf-8");
    expect(file.text.trim().split("\n")).toHaveLength(3);
  });
});

describe("applying a content file (mode content)", () => {
  const current = live([word("Ferry", "Travel"), word("Harbour", "Travel")]);
  it("merges into the live content: new words added, an edited word updated, the others kept", () => {
    const plan = contentImportPlan(contentFile([word("Ferry", "Travel", { meaning: "A boat for people and cars." }), word("Lantern", "Camping")]), "content", current, ["Travel"]);
    expect(names(plan)).toEqual(["Ferry:Travel", "Harbour:Travel", "Lantern:Camping"]);
    expect(plan.content.words.find((w) => w.word === "Ferry").meaning).toBe("A boat for people and cars.");
  });
  it("a new category joins the level order after the ones already there", () => {
    expect(contentImportPlan(contentFile([word("Lantern", "Camping")]), "content", current, ["Travel"]).order).toEqual(["Travel", "Camping"]);
  });
  it("the file's note comes back when it has one, otherwise none", () => {
    expect(contentImportPlan(contentFile([word("Lantern", "Camping")], { note: "new note" }), "content", current, ["Travel"]).note).toBe("new note");
    expect(contentImportPlan(contentFile([word("Lantern", "Camping")]), "content", current, ["Travel"]).note).toBeUndefined();
  });
  it("no renames in a v2 file", () => {
    expect(contentImportPlan(contentFile([word("Lantern", "Camping")]), "content", current, ["Travel"]).renames).toEqual({ words: [], categories: [] });
  });
  it("a file that fails the checks is refused with its first problem, and nothing is planned", () => {
    expect(() => contentImportPlan(contentFile([word("Lantern", "Camping"), word("Lantern", "Camping")]), "content", current, ["Travel"])).toThrow("words[1].word: duplicate key");
  });
});

describe("a v3 file renames words and categories (same id, new spelling or title)", () => {
  const v3 = (wordName, catTitle) => ({
    schemaVersion: 3, kind: "content",
    categories: [{ id: "trips", title: catTitle }],
    words: [{ id: "ferry", word: wordName, type: "vocab", category: "trips", partsOfSpeech: ["noun"], meaning: "A boat that carries people.",
      situations: [`We took the ${wordName} to the island.`], gaps: ["We took the ______ to the island."] }],
  });
  it("the renames are returned for progress, and the level order follows the renamed category", () => {
    const first = contentImportPlan(v3("Ferry", "Trips"), "content", live([]), []);
    expect(names(first)).toEqual(["Ferry:Trips"]);
    const second = contentImportPlan(v3("Ferryboat", "Journeys"), "content", { ...first.content, note: "" }, first.order);
    expect(names(second)).toEqual(["Ferryboat:Journeys"]);
    expect(second.renames).toEqual({ words: [{ from: "Ferry", to: "Ferryboat" }], categories: [{ from: "Trips", to: "Journeys" }] });
    expect(second.order).toEqual(["Journeys"]);
  });
});

describe("applying a backup with its content (mode full)", () => {
  const current = live([word("Ferry", "Travel"), word("Harbour", "Travel")]);
  const backup = { ...contentFile([word("Lantern", "Camping")]), kind: "backup", schemaVersion: 6, contentSchemaVersion: 2, levelOrder: ["Camping"], score: 12, mastery: { Lantern: { total: 2, correct: 2 } } };
  it("the content comes from the file alone: live words not in it are gone", () => {
    expect(names(contentImportPlan(backup, "full", current, ["Travel"]))).toEqual(["Lantern:Camping"]);
  });
  it("the file's level order is used as it is", () => {
    expect(contentImportPlan(backup, "full", current, ["Travel"]).order).toEqual(["Camping"]);
  });
  it("no renames are returned (progress is replaced, not moved)", () => {
    expect(contentImportPlan(backup, "full", current, ["Travel"]).renames).toBeNull();
  });
  it("the progress it brings back, in both modes that restore progress", () => {
    for (const mode of ["progress", "full"]) {
      const restored = restoredProgressOf(backup, mode);
      expect(restored.score).toBe(12);
      expect(restored.mastery.Lantern).toMatchObject({ total: 2, correct: 2 });
    }
  });
  it("in full mode the fields the game no longer has are dropped from what comes back (it is saved whole)", () => {
    const old = { ...backup, puns: [{ id: "old-pun" }], words: [{ ...word("Lantern", "Camping"), situation: undefined, example: "We lit the lantern at night." }] };
    const restored = restoredProgressOf(old, "full");
    expect(restored.puns).toBeUndefined();
    expect(restored.words[0].situation).toBe("We lit the lantern at night.");
    expect(restored.words[0].example).toBeUndefined();
  });
});

describe("what the player is told", () => {
  it("one sentence per mode", () => {
    expect(importDoneText("content")).toBe("Content imported; everyone's progress is kept");
    expect(importDoneText("full")).toBe("Backup restored: content and progress");
    expect(importDoneText("progress")).toBe("Your progress was restored");
  });
});
