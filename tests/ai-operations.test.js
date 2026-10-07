import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/ai", () => ({ callAiText: vi.fn(() => new Promise(() => {})) }));
import { callAiText } from "../src/lib/ai";
import * as ai from "../src/engine/ai";
import { mergeCustomData } from "../src/engine/data";
import { generateGrammarQuestions } from "../src/features/admin/editors/grammarRules.js";
import { cancelAiOperation, cancelAiTasks, describeAiError, dismissAiOperation, getAiOperations, runAiOperation, updateAiOperation } from "../src/lib/aiOperations.js";

const word = { word: "patient", meaning: "Able to wait calmly without becoming annoyed", type: "vocab", category: "Health", situation: "She is patient with children.", gap: "She is ______ with children.", hints: [] };
const question = { prompt: word.gap, answer: word.word, target: word };
const cases = [
  ["word explanation", () => ai.askAiForWord("patient", word)],
  ["written answer", () => ai.evaluateFreeForm(question, "She is patient.")],
  ["alternative answer", () => ai.evaluateAlternativeGap(question, "kind")],
  ["final report", () => ai.evaluateFinalReport([word], "She was patient.")],
  ["grammar court", () => ai.evaluateGrammarCorrection(question, "She is patient.")],
  ["wrong answer explanation", () => ai.explainWrongLead(question, word, word)],
  ["report review", () => ai.reviewReportedQuestion({ prompt: word.gap, answers: [word.word] }, { entity: "words", item: word })],
  ["combo variant", () => ai.generateComboVariant({ words: ["patient", "impatient"] })],
  ["grammar variant", () => ai.generateGrammarVariant({ rule: "present simple", prompt: "He ______ here.", answer: "works", options: ["works", "work"] })],
  ["practice generation", () => { mergeCustomData([word], [], [], ["Health"]); return ai.generateContent([{ word: word.word, poolType: "gap" }], {}); }],
  ["quality validation", () => ai.validateGeneratedContent([{ word: word.word, poolType: "gap" }], [{ text: word.gap }])],
  ["import repair", () => ai.aiFixImportJson('{"words":[]}', "Missing meaning")],
  ["report fix", () => ai.suggestReportFix({ prompt: word.gap }, word, "words")],
  ["category merge", () => ai.suggestCategoryMerges(["Health", "health"])],
  ["health fix", () => ai.aiFixWordBatch("meaning", [word], [word])],
  ["rewrite", () => ai.regenerateWordExplanation(word)],
  ["story", () => ai.generateStory([word])],
  ["grammar writing", () => generateGrammarQuestions({ rule: "present simple" }, ["choose"], 3, [word.word])],
];
afterEach(() => { cancelAiTasks(null, { includeBackground: true }); for (const job of getAiOperations()) dismissAiOperation(job.id); vi.clearAllMocks(); vi.useRealTimers(); });

describe("every textual AI feature is cancellable", () => {
  it.each(cases)("cancels %s even if the provider ignores abort", async (_label, start) => {
    const pending = start();
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); await Promise.resolve();
    expect(callAiText).toHaveBeenCalled();
    const running = getAiOperations().filter(job => job.status === "running");
    expect(running).toHaveLength(1);
    cancelAiOperation(running[0].id);
    await checked;
    expect(getAiOperations().at(-1).status).toBe("cancelled");
  });
});
describe("AI operation status", () => {
  it("reports validation errors rather than marking the HTTP success as done", async () => {
    await expect(runAiOperation("Validate", async () => { throw new SyntaxError("bad json"); })).rejects.toThrow(/unreadable/);
    expect(getAiOperations().at(-1)).toMatchObject({ status: "failed", error: expect.stringMatching(/unreadable/) });
  });
  it("keeps background work when navigating but cancels it on logout", async () => {
    const pending = runAiOperation("Background", () => new Promise(() => {}), { background: true });
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    cancelAiTasks(); expect(getAiOperations().at(-1).status).toBe("running");
    cancelAiTasks(null, { includeBackground: true }); await checked;
  });
  it("records genuine batch progress and stops future steps on cancellation", async () => {
    const visited = [];
    let finishFirst;
    const pending = runAiOperation("Batch", async signal => {
      for (let i = 0; i < 3; i++) {
        signal.throwIfAborted(); visited.push(i);
        if (!i) await new Promise(r => { finishFirst = r; });
        signal.throwIfAborted(); updateAiOperation(signal, { done: i + 1, total: 3 });
      }
    });
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); cancelAiOperation(getAiOperations().at(-1).id);
    finishFirst(); await checked; expect(visited).toEqual([0]);
  });
  it("explains authorization, quota and timeout failures", () => {
    expect(describeAiError({ status: 401 })).toMatch(/Sign in/);
    expect(describeAiError({ status: 429 })).toMatch(/allowance/);
    expect(describeAiError({ name: "TimeoutError" })).toMatch(/too long/);
  });
});
