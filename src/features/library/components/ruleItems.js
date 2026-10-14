// A grammar rule in the shape the word picker reads: { word: its name, meaning,
// category, level }, with the rule's id kept as `id` (the picker is told to use it as the key).
export const ruleItems = (grammar) => (grammar || []).map((g) => ({ ...g, word: g.rule || g.id, meaning: g.explanation || "" }));
export const ruleKey = (r) => r.id;
export const ruleName = (r) => r.word;
