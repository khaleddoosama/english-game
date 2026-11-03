// Ask AI about a word against the REAL model: the fixed cases of askAiCases.js, sent with the app's own prompt and
// checks, straight to Gemini (api/_lib/gemini.js, no gate, no log, no content saved). It costs one call per case that
// reaches the AI (7), so it runs only on purpose:
//   ASK_AI_EVAL=1 GEMINI_API_KEY=... npx vitest run tests/ask-ai-eval.test.js
// It checks what a machine can (the answer is accepted or refused as expected, the meaning is the expected one, the
// gap and hints do not give the word away) and prints every card for a person to judge the rest: is the meaning
// right, is the example natural, do the near words and the mistake really exist. Skipped in CI (no key).
// Docs: docs/modules/ai-media/ask-ai.md.
import { describe, expect, it } from "vitest";
import { generateJsonText } from "../api/_lib/gemini.js";
import { ASK_AI_INSTRUCTIONS, askAiInput, askAiTerm, readAskAiAnswer, showsWord } from "../src/lib/askAiCard.js";
import { V2 } from "../src/engine/v2";
import { ASK_AI_CASES } from "./askAiCases.js";

const ON = !!(process.env.ASK_AI_EVAL && process.env.GEMINI_API_KEY);

describe.skipIf(!ON)("Ask AI with the real model (fixed cases)", () => {
  it.each(ASK_AI_CASES.filter((c) => c.expect.status !== "refused").map((c) => [c.id, c]))("%s", async (_id, c) => {
    const term = askAiTerm(c.term);
    const { text, model } = await generateJsonText(`${ASK_AI_INSTRUCTIONS}\n\nINPUT JSON:\n${JSON.stringify(askAiInput(term, c.gameEntry, c.topic))}`);
    console.log(`\n[${c.id}] ${model}\n${text}`);
    let card, error;
    try { card = readAskAiAnswer(JSON.parse(text), { term, gameEntry: c.gameEntry }); } catch (e) { error = e; }
    if (c.expect.status === "invalid") { expect(error?.message).toMatch(c.expect.message); return; }
    expect(error).toBeUndefined();
    const { expect: e } = c;
    expect(V2.norm(card.word)).toBe(V2.norm(e.word));
    if (e.type) expect(card.type).toBe(e.type);
    if (e.partsOfSpeech) expect(card.partsOfSpeech).toEqual(expect.arrayContaining(e.partsOfSpeech));
    if (e.meaning) expect(card.meaning).toMatch(e.meaning);
    if (e.notMeaning) expect(card.meaning).not.toMatch(e.notMeaning);
    expect(card.gap, "a usable gap sentence").not.toBe("");
    // An irregular form ("gave up") is not recognised, so this is only reported.
    if (!showsWord(card.word, card.situation)) console.log(`[${c.id}] check by hand: the example may not use the word`);
    for (const h of card.hints) expect(showsWord(card.word, h)).toBe(false);
  }, 60000);
});
