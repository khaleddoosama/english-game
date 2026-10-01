// Grammar rules in the admin: old single-question rules becoming question
// sets, cleaning drafts, problems pinned to the right question, the
// table's flags, and AI questions that fail the checks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { blankGrammarQuestion, blankGrammarRule, checkAiQuestion, cleanGrammarDraft, grammarDraftOf, grammarDraftProblems, grammarIssues, grammarPreview, isSingleQuestionRule, questionCount, questionTypes } from "../src/features/admin/editors/grammarRules";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const old = backup.grammar.find((g) => g.id === "g5");
const set = {
  id: "g-test", rule: "Used to", category: "Media", level: "A2", explanation: "Past habits.", examples: ["I used to swim."], commonMistakes: [],
  questions: [
    { type: "choose", prompt: "I ______ swim.", options: ["used to", "use to"], answer: "used to", explanation: "" },
    { type: "judge", sentence: "I use to swim.", correct: false, fix: "I used to swim.", explanation: "" },
    { type: "fix", sentence: "She use to run.", answer: "She used to run.", explanation: "" },
  ],
};

describe("old single-question rules", () => {
  it("open as a set of one choose question, keeping the extra fields", () => {
    const d = grammarDraftOf(old);
    expect(isSingleQuestionRule(old)).toBe(true);
    expect(d.questions).toEqual([{ type: "choose", prompt: old.prompt, options: old.options, answer: old.answer, explanation: old.explanation }]);
    expect(d).not.toHaveProperty("prompt");
    expect(d.id).toBe("g5");
  });
  it("save as a valid question set with the same id (progress stays)", () => {
    const saved = cleanGrammarDraft(grammarDraftOf(old));
    expect(Array.isArray(saved.questions)).toBe(true);
    expect(saved.id).toBe(old.id);
    expect(grammarDraftProblems(saved, [])).toEqual([]);
    expect(V2.grammarQuestions(saved)).toHaveLength(1);
  });
  it("every rule in the backup converts without problems", () => {
    for (const g of backup.grammar) expect(grammarDraftProblems(cleanGrammarDraft(grammarDraftOf(g)), [])).toEqual([]);
  });
  it("editing the draft doesn't touch the original rule", () => {
    const d = grammarDraftOf(old);
    d.questions[0].options[0] = "changed";
    expect(old.options[0]).not.toBe("changed");
  });
});

describe("cleaning a draft", () => {
  it("trims text and drops empty options, examples and half-written mistakes", () => {
    const d = cleanGrammarDraft({ ...set, rule: "  Used to ", examples: ["", " I used to swim. "], commonMistakes: [{ sentence: "a", correction: "b", why: "c" }, { sentence: "only this" }],
      questions: [{ type: "choose", prompt: " p ", options: [" a ", "", "b"], answer: " a " }] });
    expect(d.rule).toBe("Used to");
    expect(d.examples).toEqual(["I used to swim."]);
    expect(d.commonMistakes).toEqual([{ sentence: "a", correction: "b", why: "c" }]);
    expect(d.questions[0]).toEqual({ type: "choose", explanation: "", prompt: "p", options: ["a", "b"], answer: "a" });
  });
  it("keeps only the judge field that fits", () => {
    const [wrong, right] = cleanGrammarDraft({ ...set, questions: [{ type: "judge", sentence: "s", correct: false, fix: "f", alternative: "x" }, { type: "judge", sentence: "s", correct: true, fix: "f", alternative: "a" }] }).questions;
    expect(wrong).not.toHaveProperty("alternative");
    expect(right).not.toHaveProperty("fix");
    expect(right.alternative).toBe("a");
  });
  it("drops an empty level", () => {
    expect(cleanGrammarDraft({ ...set, level: "" })).not.toHaveProperty("level");
  });
});

describe("problems", () => {
  it("a complete set has none", () => {
    expect(grammarDraftProblems(cleanGrammarDraft(set), [])).toEqual([]);
  });
  it("are pinned to the question they belong to", () => {
    const d = cleanGrammarDraft({ ...set, questions: [set.questions[0], { type: "fix", sentence: "Same.", answer: "Same." }, blankGrammarQuestion("choose")] });
    const p = grammarDraftProblems(d, []);
    expect(p.filter((x) => x.at === 0)).toEqual([]);
    expect(p.find((x) => x.at === 1).text).toMatch(/answer: must differ/);
    expect(p.filter((x) => x.at === 2).map((x) => x.text).join(" ")).toMatch(/prompt/);
  });
  it("an answer that isn't one of the options", () => {
    const d = cleanGrammarDraft({ ...set, questions: [{ ...set.questions[0], answer: "used" }] });
    expect(grammarDraftProblems(d, [])).toContainEqual({ at: 0, text: "answer: answer missing from options" });
  });
  it("rule-level problems: no questions, missing text, ids", () => {
    const texts = (d, others = []) => grammarDraftProblems(cleanGrammarDraft(d), others).filter((x) => x.at == null).map((x) => x.text).join("\n");
    expect(texts({ ...set, questions: [] })).toMatch(/Questions: expected at least one question/);
    expect(texts({ ...set, rule: "", explanation: " " })).toMatch(/Rule: expected non-empty string[\s\S]*Explanation/);
    expect(texts({ ...set, id: "" })).toMatch(/Id: needed/);
    expect(texts({ ...set, id: "a:b" })).toMatch(/can't contain/);
    expect(texts(set, [{ id: "G-TEST" }])).toMatch(/another rule already uses it/);
    expect(texts({ ...set, explanation: "قاعدة" })).toMatch(/English only/);
  });
  it("a new blank rule isn't savable until it's filled in", () => {
    expect(grammarDraftProblems(cleanGrammarDraft(blankGrammarRule("g-new", "Media")), []).length).toBeGreaterThan(0);
  });
});

describe("table flags and summaries", () => {
  it("a good rule has no flags; counts and types add up", () => {
    expect(grammarIssues(set)).toEqual([]);
    expect(questionCount(set)).toBe(3);
    expect(questionTypes(set)).toEqual({ choose: 1, judge: 1, fix: 1 });
    expect(grammarPreview(set)).toBe("I ______ swim.");
    expect(grammarPreview(old)).toBe(old.prompt);
  });
  it("flags errors, a missing explanation and unplayable rules", () => {
    const ids = (g) => grammarIssues(g).map((i) => i.id);
    expect(ids({ ...set, explanation: "" })).toEqual(expect.arrayContaining(["invalid", "no-explanation"]));
    expect(ids({ ...set, questions: [] })).toEqual(expect.arrayContaining(["invalid", "no-questions"]));
    expect(ids({ ...old, answer: "nope" })).toContain("invalid");
  });
});

describe("AI questions", () => {
  it("a good one is selected", () => {
    const r = checkAiQuestion({ type: "fix", sentence: "He go home.", answer: "He goes home.", explanation: "x" }, ["fix"]);
    expect(r).toMatchObject({ ok: true, selected: true, reason: "" });
  });
  it("one of a type that wasn't asked for is skipped", () => {
    expect(checkAiQuestion(set.questions[0], ["fix"])).toMatchObject({ ok: false, reason: "type not requested" });
  });
  it("a broken one says why, and isn't selected", () => {
    const r = checkAiQuestion({ type: "choose", prompt: "p", options: ["a", "a"], answer: "b" }, ["choose"]);
    expect(r.ok).toBe(false);
    expect(r.selected).toBe(false);
    expect(r.reason).toMatch(/duplicate options/);
  });
  it("junk from the AI doesn't crash the check", () => {
    for (const junk of [{}, { type: "choose" }, { type: "judge", correct: "yes" }]) expect(checkAiQuestion(junk, ["choose", "judge", "fix"]).ok).toBe(false);
  });
});
