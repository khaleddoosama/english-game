// New practice sentences and variants, the steps with no state: the pools after the AI's answer, what a grammar
// variant request sends, and the wait after a failed try. No React, no AI call. Moved unchanged out of the app shell
// (src/app/WordHunter.jsx; the id maker became an argument); see docs/modules/ai-media/pool-generation.md.
import { V2 } from "../../engine/v2";
import { getWordPools } from "../../engine/questions";

export const newItemId = () => `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
// A failed variant try waits this long before the next one for the same id.
export const VARIANT_RETRY_MS = 600000;
export const mayRetryVariant = (failedAt, now = Date.now()) => now - (failedAt || 0) >= VARIANT_RETRY_MS;
// "grammar:g-1" -> "g-1"
export const idOfKey = (key) => key.slice(key.indexOf(":") + 1);

// The word pools with each answer ({ word, poolType, text }) added as a new item at the end of its pool. Answers for
// a word the game does not know, or with no text, are skipped.
export function withGeneratedTexts(prev, results, words, makeId = newItemId) {
  const next = { ...prev };
  for (const item of results) {
    const wordObj = words.find((w) => w.word === item.word);
    if (!wordObj || !item.text) continue;
    const wp = getWordPools(next, wordObj);
    const newItem = {
      id: makeId(),
      text: item.text,
      attempts: 0,
      correctCount: 0,
      lockedUntil: null,
      flagged: false,
    };
    next[item.word] = { ...wp, [item.poolType]: [...wp[item.poolType], newItem] };
  }
  return next;
}

// The pools with a new variant (fields: combo { situation, prompt }; grammar { prompt, options, answer, explanation })
// at the end of pools[key].variant.
export function withVariantItem(prev, key, fields, makeId = newItemId) {
  const existing = prev[key]?.variant?.length ? prev[key].variant : [];
  const newItem = { id: makeId(), ...fields, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
  return { ...prev, [key]: { ...prev[key], variant: [...existing, newItem] } };
}
export const comboVariantFields = (variant) => ({ situation: variant.situation, prompt: variant.prompt });
export const grammarVariantFields = (variant) => ({ prompt: variant.prompt, options: variant.options, answer: variant.answer, explanation: variant.explanation });

// What a grammar variant request sends: the rule, its explanation and the question's base, with every prompt already
// used (the rule's own questions and its variants) so the new one differs.
export function grammarVariantAsk(g, pools, key) {
  const base = V2.grammarVariantBase(g);
  const used = [...V2.grammarQuestions(g).map((x) => x.prompt || x.sentence), ...(pools[key]?.variant || []).map((x) => x.prompt)].filter(Boolean);
  return { spec: { rule: g.rule, ruleExplanation: g.explanation, ...base }, used };
}
