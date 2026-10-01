import { describe, expect, it } from "vitest";
import { changesToRows, fieldChanges, listDiff, wordDiff } from "../src/features/admin/diff.jsx";
import { reportView } from "../src/features/admin/sections/Reports.jsx";

describe("before/after diffs", () => {
  it("lists only the fields that changed", () => {
    const rows = fieldChanges({ word: "Fork", meaning: "a tool", hints: ["eat"], gap: "x" }, { word: "Fork", meaning: "a tool for eating", hints: ["eat"], image: "u" });
    expect(rows.map((r) => r.field).sort()).toEqual(["gap", "image", "meaning"]);
    expect(rows.find((r) => r.field === "gap")).toEqual({ field: "gap", before: "x", after: undefined });
    expect(fieldChanges(null, { a: 1 })).toEqual([{ field: "a", before: undefined, after: 1 }]);
    expect(fieldChanges({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });

  it("turns server change records into rows", () => {
    expect(changesToRows({ meaning: { before: "a", after: "b" } })).toEqual([{ field: "meaning", before: "a", after: "b" }]);
    expect(changesToRows(null)).toEqual([]);
  });

  it("marks the words that changed inside a text", () => {
    const parts = wordDiff("a small tool for eating", "a metal tool for eating food");
    const text = (op) => parts.filter((p) => p.op === op).map((p) => p.t.trim()).filter(Boolean);
    expect(text("del")).toEqual(["small"]);
    expect(text("ins")).toEqual(["metal", "food"]);
    expect(parts.map((p) => (p.op === "del" ? "" : p.t)).join("")).toBe("a metal tool for eating food");
    expect(parts.map((p) => (p.op === "ins" ? "" : p.t)).join("")).toBe("a small tool for eating");
  });

  it("handles empty and identical texts", () => {
    expect(wordDiff("", "new words").every((p) => p.op === "ins")).toBe(true);
    expect(wordDiff("same text", "same text")).toEqual([{ t: "same text", op: "same" }]);
    expect(wordDiff(null, undefined)).toEqual([]);
  });

  it("compares lists", () => {
    expect(listDiff(["a", "b"], ["b", "c"])).toEqual({ removed: ["a"], added: ["c"], kept: ["b"] });
    expect(listDiff(undefined, ["x"])).toEqual({ removed: [], added: ["x"], kept: [] });
  });
});

describe("report details", () => {
  it("reads a full report", () => {
    const v = reportView({
      id: "rep-1", at: 1790000000000, reason: "Wrong or missing correct answer", details: "Both fit",
      learnerAnswer: ["Bread", "Cheese"], learnerAnswerText: "Bread + Cheese", wasCorrect: false, answerSubmitted: true,
      question: { id: "q1", mode: "selecttwo", type: "multi", prompt: "Pick two foods", options: ["Bread", "Cheese", "Chair"], answers: ["Bread", "Chair"], targets: ["bread"] },
      session: { title: "Food", kind: "practice", index: 2, total: 12 }, reporter: { username: "sara" }, _from: "sara",
    });
    expect(v).toMatchObject({ key: "rep-1", prompt: "Pick two foods", mode: "selecttwo", playerAnswer: "Bread + Cheese", wasCorrect: false, submitted: true, reason: "Wrong or missing correct answer", note: "Both fit", reporter: "sara", filedAt: 1790000000000 });
    expect(v.answerList).toEqual(["Bread", "Cheese"]);
    expect(v.options).toHaveLength(3);
    expect(v.session.index).toBe(2);
  });

  it("reads an old flat report and one with no answer", () => {
    const old = reportView({ prompt: "Old", mode: "gap", options: ["a", "b"], answers: ["a"], learnerAnswer: "b", targetWords: ["x"], at: 5 }, 3);
    expect(old).toMatchObject({ key: "idx-3", prompt: "Old", playerAnswer: "b", targets: ["x"], reporter: "you", submitted: true });
    const none = reportView({ id: "r", prompt: "P", learnerAnswer: null, answerSubmitted: false });
    expect(none.playerAnswer).toBeNull();
    expect(none.submitted).toBe(false);
  });

  it("uses the server time when the report has none", () => {
    const v = reportView({ id: "r", prompt: "P", _filedAt: "2026-10-01T10:00:00Z" });
    expect(v.filedAt).toBe(Date.parse("2026-10-01T10:00:00Z"));
  });
});
