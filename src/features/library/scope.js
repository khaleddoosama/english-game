// What a personal view holds, in the shape the practice builder takes:
// { words: Set of word keys, rules: Set of rule ids }. The view API answers
// with ids; resolveKey maps a word's id to the key the game uses for it
// (the same text while words are still keyed by text).
export function scopeFromContents(rows, { resolveKey = (id) => id, resolveRule = (id) => id } = {}) {
  const words = new Set(), rules = new Set();
  for (const r of rows || []) {
    if (r.kind === "sense") { const k = resolveKey(r.id); if (k) words.add(k); }
    else if (r.kind === "rule") { const k = resolveRule(r.id); if (k) rules.add(k); }
  }
  return { words, rules };
}

export const scopeIsEmpty = (scope) => !scope || (!scope.words.size && !scope.rules.size);

// The words and rules of a scope, for Live challenges and anything else that
// takes plain lists.
export function scopedLists(content, scope) {
  return {
    words: (content.words || []).filter((w) => scope.words.has(w.word)),
    grammar: (content.grammar || []).filter((g) => scope.rules.has(g.id)),
  };
}
