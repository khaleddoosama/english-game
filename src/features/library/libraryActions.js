// The changes the library page makes, and the sentence that tells the player
// what happened. Each action is [what to run, what to say]; the page runs it
// through useViews().act, which shows the sentence and reloads. No React here.
import { count } from "./components/format";

export function libraryActions({ api, ids }) {
  const senses = (keys) => keys.map(ids.senseOf).filter(Boolean);
  const rules = (keys) => keys.map(ids.ruleOf).filter(Boolean);
  return {
    addRulesToView: (viewId, keys) => [() => api.addRules(viewId, rules(keys)), (n) => (n ? `Added ${count(n, "rule")} to the view.` : "Those are already in that view.")],
    addToView: (viewId, keys) => [() => api.add(viewId, senses(keys)), (n) => (n ? `Added ${n} to the view.` : "Those are already in that view.")],
    removeRules: (keys) => [async () => { for (const k of keys) await api.libraryRemoveRule(ids.ruleOf(k)); return keys.length; }, (n) => `Removed ${count(n, "rule")} from your library.`],
    removeWords: (keys) => [async () => { for (const k of keys) await api.libraryRemove(ids.senseOf(k)); return keys.length; }, (n) => `Removed ${count(n, "word")} from your library.`],
    newViewWith: (name, keys) => [async () => { const made = await api.create(name); await api.add(made, senses(keys)); return made; }, `Made “${name.trim()}” with ${count(keys.length, "word")}.`],
  };
}

// What the player is told after taking a friend's offer.
export function offerAcceptedText(out) {
  const rulesText = out.rules ? `, ${count(out.rules, "rule")}` : "";
  const skipped = out.skipped ? ` (${out.skipped} private ${out.skipped === 1 ? "word was" : "words were"} not shared)` : "";
  return `Added “${out.name}”: ${count(out.words, "word")}${rulesText}${skipped}.`;
}
