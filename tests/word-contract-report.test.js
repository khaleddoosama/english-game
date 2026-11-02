// The dry run of the word contract (scripts/word-contract-report.mjs, ADR 0011 step 1) on made-up stored rows that cover
// what production has: single fields next to lists, a conflict, a stored opposite, relations (with an antonym missing
// from antonyms), empty lists, retired and unknown keys, references to no word and to a deleted word. It reads a
// file and writes a report; it never touches a database.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport } from "../scripts/word-contract-report.mjs";

const word = (w, extra = {}) => ({ word: w, type: "vocab", category: "Travel", partsOfSpeech: ["noun"], meaning: `The meaning of ${w}.`, situation: `We saw the ${w}.`, gap: "We saw the ______ there.", hints: ["A hint."], ...extra });
const rows = [
  { kind: "words", key: "Ferry", deleted: false, data: word("Ferry", { situations: ["We saw the Ferry.", "It was late."], gaps: ["We saw the ______ there."], antonyms: [], register: "informal", learningData: { cluster: "boats", difficulty: "easy" } }) },
  { kind: "words", key: "Raft", deleted: false, data: word("Raft", { situation: "B was shown.", situations: ["A was first.", "C."], acceptedWrittenAnswers: ["raft"] }) },
  { kind: "words", key: "Calm", deleted: false, data: word("Calm", { antonyms: ["Stormy"], opposite: "Stormy", relations: { antonyms: ["Stormy", "Windy"], synonyms: ["Quiet"], confusableWords: ["Ferry", "Barge", "Old"] }, synonyms: ["Quiet"] }) },
  { kind: "words", key: "Windy", deleted: false, data: word("Windy") },
  { kind: "words", key: "Bad", deleted: false, data: word("Bad", { gap: "No blank here." }) },
  { kind: "words", key: "Old", deleted: true, data: {} },
  { kind: "grammar", key: "g1", deleted: false, data: { id: "g1" } },
];

describe("the dry run", () => {
  const report = buildReport(rows);
  const byKey = Object.fromEntries(report.words.map((w) => [w.key, w]));

  it("counts only live word rows, and sorts each into converts, needs a decision, or fails the check", () => {
    expect(report.summary).toMatchObject({ activeWords: 5, converts: 2, needsDecision: 2, failsCheck: 1, notIdempotent: 0, conflicts: 1, antonymEntries: 1 });
    expect(Object.fromEntries(report.words.map((w) => [w.key, w.status]))).toEqual({ Ferry: "converts", Raft: "needs-decision", Calm: "needs-decision", Windy: "converts", Bad: "fails-check" });
  });
  it("lists what is moved, removed as empty and archived, with the archived values", () => {
    expect(byKey.Ferry.changes).toEqual(expect.arrayContaining([{ path: "antonyms", what: "empty-removed" }, { path: "situation", what: "derived-dropped" }, { path: "gap", what: "derived-dropped" }]));
    expect(byKey.Ferry.archive).toEqual([{ path: "register", value: "informal", reason: "retired" }, { path: "learningData.difficulty", value: "easy", reason: "retired" }]);
    expect(report.summary.archived).toEqual({ register: 1, "learningData.difficulty": 1, acceptedWrittenAnswers: 1 });
  });
  it("shows a conflict with what Choice A would give, and proves every pool id keeps its text", () => {
    expect(byKey.Raft.conflicts).toEqual([expect.objectContaining({
      field: "situations", shown: "B was shown.", listFirst: "A was first.", choiceA: ["B was shown.", "C.", "A was first."],
      poolBefore: [{ id: "seed", text: "B was shown." }, { id: "seed-2", text: "C." }],
      choiceAKeepsEveryPoolText: true,
    })]);
  });
  it("shows a relations.antonyms entry with both meanings and its effect, and leaves the recommendation to a person", () => {
    expect(byKey.Calm.antonymEntries).toEqual([{ value: "Windy", namesLiveWord: true, thisMeaning: "The meaning of Calm.", otherMeaning: "The meaning of Windy.", effect: expect.stringContaining("an opposite pair in play"), recommendation: null }]);
  });
  it("classes references in confusableWords as live, deleted or no word, and keeps them", () => {
    expect(byKey.Calm.confusableReferences).toEqual([{ value: "Ferry", class: "live" }, { value: "Barge", class: "none" }, { value: "Old", class: "deleted" }]);
    expect(report.summary.confusableReferences).toEqual({ live: 1, deleted: 1, none: 1 });
  });
  it("names what this step does not compute", () => {
    expect(report.notComputed).toHaveLength(4);
  });
  it("the command reads a file and writes a report file, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-"));
    writeFileSync(join(dir, "rows.json"), JSON.stringify(rows));
    const out = execFileSync("node", ["scripts/word-contract-report.mjs", join(dir, "rows.json"), "--out", join(dir, "report.json")], { encoding: "utf8", env: { ...process.env, PGURL: "", DATABASE_URL: "" } });
    expect(JSON.parse(out)).toEqual(report.summary);
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).words).toHaveLength(5);
  });
});
