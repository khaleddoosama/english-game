// The game's copy of the content, built in one step from the lists: words one per text, grammar rules and challenges
// one per id, opposites linked, one level per name in the level order, and the badges. No state; the content module
// keeps the current copy (features/content/gameContent.js). Docs: docs/modules/content/content-catalog.md.
import { V2 } from "./v2";

// Keeps only the first entry for each key — a safety net so a word can never
// be dealt into the same round twice, no matter how it ended up duplicated
// (repeated imports, a review that reintroduced an entry, case differences).
export function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// One level: the category's words, then its grammar rules, then its challenges.
export function buildLevel(title, words, grammar, challenges) {
  return {
    id: `cat-${title}`,
    title,
    items: [
      ...words.filter((w) => w.category === title).map((w) => ({ kind: "word", obj: w })),
      ...grammar.filter((g) => g.category === title).map((g) => ({ kind: "grammar", obj: g })),
      ...challenges.filter((c) => c.category === title).map((c) => ({ kind: "challenge", obj: c })),
    ],
  };
}

// One badge per level, then the fixed ones.
export function badgesFor(levels) {
  return [
    ...levels.map((level) => ({
      id: level.id,
      type: "category",
      category: level.title,
      label: `${level.title} Files Closed`,
    })),
    { id: "streak-5", type: "streak", threshold: 5, label: "Warming Up" },
    { id: "streak-10", type: "streak", threshold: 10, label: "On a Roll" },
    { id: "streak-20", type: "streak", threshold: 20, label: "Unstoppable" },
    { id: "completionist", type: "completionist", label: "Full Case Archive" },
  ];
}

// The whole copy: { words, grammar, challenges, levelOrder, levels, badges }. The level order is kept as given.
export function buildCatalog(words, grammar, challenges, levelOrder) {
  const linked = V2.linkAntonyms(dedupeBy(words, (w) => w.word && w.word.trim().toLowerCase()));
  const rules = dedupeBy(grammar, (g) => g.id);
  const authored = dedupeBy(Array.isArray(challenges) ? challenges : [], (c) => c && c.id);
  const levels = levelOrder.map((title) => buildLevel(title, linked, rules, authored));
  return { words: linked, grammar: rules, challenges: authored, levelOrder, levels, badges: badgesFor(levels) };
}
