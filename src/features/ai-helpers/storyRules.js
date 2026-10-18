// Story generation, the step with no state: which words and grammar rules a new story hides. No React, no AI call.
// Moved unchanged out of the app shell (src/app/WordHunter.jsx; Math.random became the `random` argument); see
// docs/modules/ai-media/story-generation.md.
import { V2 } from "../../engine/v2";
import { getWeakWordCandidates } from "../../engine/progress";

// words, grammar: the game's content; categories: the chosen ones; stories: the stories already there.
// Returns { targets (shuffled), grammarRules }; throws when the categories have fewer than five vocab words.
export function storyPlan({ words, grammar, categories, stories, mastery, confusions }, random = Math.random) {
  const usedElsewhere = new Set(stories.flatMap((story) => (story.targetWords || []).map((w) => V2.norm(w))));
  const weakOrder = new Map(getWeakWordCandidates(words, mastery, confusions).map((item, index) => [item.word.word, index]));
  // Words already used as a target in an earlier generated story are
  // pushed to the back of each category's pool (not hard-excluded) —
  // so a new story reaches for fresh vocabulary first, and only falls
  // back to a repeat if a category genuinely has nothing left unused.
  const byCategory = categories.map((category) => {
    const all = V2.shuffleCopy(words.filter((word) => word.category === category), random).sort((a, b) => (weakOrder.get(a.word) ?? 9999) - (weakOrder.get(b.word) ?? 9999));
    const fresh = all.filter((w) => !usedElsewhere.has(V2.norm(w.word)));
    const reused = all.filter((w) => usedElsewhere.has(V2.norm(w.word)));
    return { category, words: [...fresh, ...reused] };
  }).filter((group) => group.words.length);
  const vocabAvailable = byCategory.reduce((sum, group) => sum + group.words.filter((w) => (w.type || "vocab") === "vocab").length, 0);
  if (vocabAvailable < 5) throw new Error("The selected categories need at least five vocab words in total.");
  const targets = [];
  // "idiom / binomial / fyi / phrasal" targets are ADDITIONAL to the 5-7
  // vocab targets below, not counted against that budget — pick one of
  // each (when the selected categories actually contain one), randomly
  // among the weakest few so a manual "Regenerate" isn't stuck retrying
  // the same troublesome word forever.
  const REQUIRED_TYPES = ["idiom", "binomial", "fyi", "phrasal"];
  const allWords = byCategory.flatMap((group) => group.words);
  for (const type of REQUIRED_TYPES) {
    const candidates = allWords.filter((w) => w.type === type && !targets.some((t) => t.word === w.word)).sort((a, b) => (usedElsewhere.has(V2.norm(a.word)) ? 1 : 0) - (usedElsewhere.has(V2.norm(b.word)) ? 1 : 0) || (weakOrder.get(a.word) ?? 9999) - (weakOrder.get(b.word) ?? 9999)).slice(0, 3);
    const pick = candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
    if (pick) targets.push(pick);
  }
  // Now fill the separate 5-7 vocab-only budget via the same
  // weak-word-first, round-robin-across-categories approach.
  const vocabByCategory = byCategory.map((group) => ({ category: group.category, words: group.words.filter((w) => (w.type || "vocab") === "vocab") }));
  const vocabTargetCount = Math.min(7, Math.max(5, categories.length + 3), vocabAvailable);
  const vocabTargets = [];
  while (vocabTargets.length < vocabTargetCount && vocabByCategory.some((group) => group.words.length)) for (const group of vocabByCategory) { if (vocabTargets.length >= vocabTargetCount) break; const word = group.words.shift(); if (word && !vocabTargets.some((item) => item.word === word.word)) vocabTargets.push(word); }
  targets.push(...vocabTargets);
  // Pick which grammar RULES to weave in (up to 2, deduped by rule text)
  // from the selected categories — the AI writes the actual example
  // sentence and question, then generateStory verifies it's really in
  // the story before trusting it.
  const grammarRulePool = V2.shuffleCopy((grammar || []).filter((g) => categories.some((cat) => V2.topic(cat) === V2.topic(g.category))), random);
  const seenRules = new Set(), grammarRules = [];
  for (const g of grammarRulePool) { const key = V2.norm(g.rule); if (seenRules.has(key)) continue; seenRules.add(key); grammarRules.push({ rule: g.rule, category: g.category }); if (grammarRules.length >= 2) break; }
  return { targets: V2.shuffleCopy(targets, random), grammarRules };
}
