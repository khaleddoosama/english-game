// Question reports, the pure rules (src/features/reports/reportRules.js), moved unchanged out of the app shell.
// Before the move they were compared with the original code on many inputs (see docs/modules/practice/question-reports.md).
import { describe, expect, it } from "vitest";
import { KEEP_RESOLVED, answerTextOf, buildReport, followRenames, mapReport, quarantineOf, sameReport, withReport, withoutReport } from "../src/features/reports/reportRules";

const q = { id: "q1", mode: "meaning", type: "mcq", prompt: "A planned series of actions", targets: ["Campaign"], options: ["a", "b"], answers: ["a"], poolType: "gap", poolItemId: "p1", explanation: "why" };
const session = { id: "s1", title: "Practice", kind: "practice", index: 2, queue: [1, 2, 3] };

describe("what a report holds", () => {
  const at = 1_700_000_000_000;
  const make = (over = {}) => buildReport({ ...q, ...over.q }, { ...session, ...over.session }, "Typo", over.answer ?? "a", "note", over.prior ?? null, "reporter" in over ? over.reporter : { id: "u1", username: "ann" }, at, () => 0.5);

  it("the question, the answer, the reason, the round and the sender, with a time and an id made from the clock", () => {
    const r = make();
    expect(r).toMatchObject({
      id: `rep-${at}-${(0.5).toString(36).slice(2, 8)}`, questionId: "q1", sessionId: "s1", prompt: q.prompt, targetWords: ["Campaign"], mode: "meaning", type: "mcq",
      options: ["a", "b"], answers: ["a"], poolType: "gap", poolItemId: "p1", reason: "Typo", details: "note", learnerAnswer: "a", learnerAnswerText: "a", answerSubmitted: false, wasCorrect: null,
      at, reportedAt: new Date(at).toISOString(), reporter: { id: "u1", username: "ann" },
      session: { id: "s1", title: "Practice", kind: "practice", index: 2, total: 3 },
    });
    expect(r.question).toMatchObject({ id: "q1", explanation: "why", hasPicture: false, targets: ["Campaign"] });
    expect(Array.isArray(r.question.sentences)).toBe(true);
  });
  it("a question the player already answered records whether it was marked right; a reported or missing answer does not", () => {
    expect(make({ prior: { correct: true } })).toMatchObject({ answerSubmitted: true, wasCorrect: true });
    expect(make({ prior: { correct: false } })).toMatchObject({ answerSubmitted: true, wasCorrect: false });
    expect(make({ prior: { correct: true, reported: true } })).toMatchObject({ answerSubmitted: true, wasCorrect: null });
    expect(make({ prior: {} })).toMatchObject({ answerSubmitted: true, wasCorrect: null });
  });
  it("a missing sender is 'local'; gaps in the question and the round become null or empty, not undefined", () => {
    expect(make({ reporter: null }).reporter).toEqual({ id: "local", username: "local" });
    const r = make({ q: { targets: undefined, options: undefined, answers: undefined, type: undefined, poolType: undefined, poolItemId: undefined, explanation: undefined }, session: { title: undefined, kind: undefined, index: undefined, queue: undefined } });
    expect(r).toMatchObject({ targetWords: [], options: null, answers: null, type: null, poolType: null, poolItemId: null, session: { title: null, kind: null, index: null, total: null } });
    expect(r.question.explanation).toBeNull();
  });
  it("a picture or a photo on the question is noted", () => {
    expect(make({ q: { picture: "x.png" } }).question.hasPicture).toBe(true);
    expect(make({ q: { photo: "y" } }).question.hasPicture).toBe(true);
  });
  it("the answer as text: nothing stays null, a list is joined, a typed or picked answer is read, anything else is a string", () => {
    expect(answerTextOf(undefined)).toBeNull();
    expect(answerTextOf(null)).toBeNull();
    expect(answerTextOf(["a", "b"])).toBe("a + b");
    expect(answerTextOf({ text: "typed" })).toBe("typed");
    expect(answerTextOf({ selected: ["x", "y"] })).toBe("x + y");
    expect(answerTextOf({})).toBe("");
    expect(answerTextOf(7)).toBe("7");
    expect(make({ answer: "" }).learnerAnswerText).toBeNull();      // an empty answer is no text
    expect(make({ answer: 0 })).toMatchObject({ learnerAnswer: 0, learnerAnswerText: "0" });
  });
});

describe("which report is which", () => {
  it("by id; without an id only the very same object counts", () => {
    expect(sameReport({ id: "a" }, { id: "a", other: 1 })).toBe(true);
    expect(sameReport({ id: "a" }, { id: "b" })).toBe(false);
    const old = { prompt: "p" };
    expect(sameReport(old, old)).toBe(true);
    expect(sameReport(old, { prompt: "p" })).toBe(false);
    expect(sameReport({}, {})).toBe(false);
    expect(sameReport(undefined, undefined)).toBe(true);
  });
});

describe("how many are kept", () => {
  const done = (i) => ({ id: `d${i}`, resolvedAt: i + 1 });
  const open = (i) => ({ id: `o${i}`, resolvedAt: null });
  it("every unresolved report stays, and only the newest 150 resolved ones, resolved first", () => {
    const list = [...Array.from({ length: 200 }, (_, i) => done(i)), ...Array.from({ length: 30 }, (_, i) => open(i))];
    const next = withReport(list, open(99));
    expect(KEEP_RESOLVED).toBe(150);
    expect(next.filter((r) => r.resolvedAt)).toHaveLength(150);
    expect(next.filter((r) => r.resolvedAt)[0].id).toBe("d50");                 // the oldest 50 resolved ones went
    expect(next.filter((r) => !r.resolvedAt)).toHaveLength(31);
    expect(next.slice(0, 150).every((r) => r.resolvedAt)).toBe(true);
    expect(next.at(-1).id).toBe("o99");
  });
  it("a list that is not there yet is empty", () => {
    expect(withReport(undefined, open(1))).toEqual([open(1)]);
    expect(withReport(null, open(1))).toEqual([open(1)]);
  });
});

describe("changing or removing one", () => {
  const list = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { n: 3 }];
  it("only the matching report changes; the others are the same objects", () => {
    const next = mapReport(list, { id: "b" }, (r) => ({ ...r, n: 20 }));
    expect(next.map((r) => r.n)).toEqual([1, 20, 3]);
    expect(next[0]).toBe(list[0]);
  });
  it("an old report with no id is matched only by being the same object", () => {
    expect(mapReport(list, { n: 3 }, (r) => ({ ...r, n: 0 })).map((r) => r.n)).toEqual([1, 2, 3]);
    expect(mapReport(list, list[2], (r) => ({ ...r, n: 0 })).map((r) => r.n)).toEqual([1, 2, 0]);
    expect(withoutReport(list, { id: "a" }).map((r) => r.n)).toEqual([2, 3]);
    expect(withoutReport(list, { n: 3 })).toHaveLength(3);
  });
  it("a missing list is an empty one", () => {
    expect(mapReport(undefined, { id: "a" }, (r) => r)).toEqual([]);
    expect(withoutReport(undefined, { id: "a" })).toEqual([]);
  });
});

describe("which (word, mode) pairs are held back", () => {
  it("every word of an unresolved report, with its mode, trimmed and in lower case", () => {
    const set = quarantineOf([{ mode: "gap", targetWords: [" Campaign ", "Cast"] }, { mode: "meaning", targetWords: ["Fork"] }]);
    expect([...set].sort()).toEqual(["campaign|gap", "cast|gap", "fork|meaning"]);
  });
  it("a resolved report holds nothing back; a report with no words holds nothing back", () => {
    expect(quarantineOf([{ mode: "gap", targetWords: ["A"], resolvedAt: 5 }, { mode: "gap", targetWords: [] }, { mode: "gap" }, { mode: "gap", targetWords: [null, ""] }]).size).toBe(0);
  });
});

describe("a renamed word", () => {
  it("its reports point at the new name; other words and reports without words stay", () => {
    const next = followRenames([{ id: "1", targetWords: ["Old", "Other"] }, { id: "2" }, { id: "3", targetWords: [] }], new Map([["Old", "New"]]));
    expect(next.map((r) => r.targetWords)).toEqual([["New", "Other"], [], []]);
    expect(next.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});
