// Content admin, the pure rules: what renaming a word, merging categories, removing empty levels and editing the
// level list do to the content lists and the level order, and how progress keys follow a rename. No state, no I/O,
// no React. Moved unchanged out of the app shell (src/app/WordHunter.jsx); see docs/modules/admin/content-admin.md.
import { V2 } from "../../engine/v2";

// content: { words, grammar, challenges, combos, stories } as the admin edits them (the custom lists).

// A word renamed: the word is replaced, and stories, combos, challenges and other words that point at the old name
// follow. The caller checks first that the new name is free (renameProblem). Grammar is passed through for
// V2.applyRenames but the caller keeps its own list (as the shell did).
export function renamedWord(content, from, nextWord) {
  const renames = { words: [{ from, to: nextWord.word }], categories: [] };
  const words = content.words.map((w) => (V2.norm(w.word) === V2.norm(from) ? nextWord : w));
  const linked = V2.applyRenames({ words, combos: content.combos, stories: content.stories, challenges: content.challenges, grammar: content.grammar }, renames);
  return { linked, renames };
}

export const withWordFields = (words, wordName, patch) => words.map((w) => (V2.norm(w.word) === V2.norm(wordName) ? { ...w, ...patch } : w));

// Category names merged in one pass over every content list and the level order, so no empty duplicate level is
// left behind. canonical keeps its place in the order, or takes the place of the first duplicate. null: nothing to do.
export function mergedCategories(content, levelOrder, canonical, duplicates) {
  const dup = new Set(duplicates.filter((name) => name !== canonical));
  if (!dup.size) return null;
  const remap = (item) => (dup.has(item.category) ? { ...item, category: canonical } : item);
  let order = [...levelOrder];
  if (!order.includes(canonical)) { const at = order.findIndex((t) => dup.has(t)); order.splice(at < 0 ? order.length : at, 0, canonical); }
  order = order.filter((t) => !dup.has(t));
  return {
    words: content.words.map(remap), grammar: content.grammar.map(remap), challenges: content.challenges.map(remap), combos: content.combos.map(remap), stories: content.stories.map(remap),
    order, renames: { words: [], categories: [...dup].map((from) => ({ from, to: canonical })) },
  };
}

// The level order without the levels no item uses, and how many were taken out.
export function withoutEmptyLevels(content, levelOrder) {
  const used = new Set([...content.words, ...content.grammar, ...content.challenges, ...content.combos, ...content.stories].map((item) => item.category).filter(Boolean));
  const order = levelOrder.filter((title) => used.has(title));
  return { order, removed: levelOrder.length - order.length };
}

// The levels editor's list ([{ id: "cat-<title>", title }]) applied: a level missing from it is deleted with its
// items, a level whose title changed is renamed and its items move, and the order becomes the list's order.
export function editedLevels(content, levelOrder, nextList) {
  const current = levelOrder.map((title) => ({ id: `cat-${title}`, title }));
  const nextById = new Map(nextList.filter((level) => level.id).map((level) => [level.id, level.title]));
  const deleted = new Set(current.filter((level) => !nextById.has(level.id)).map((level) => level.title));
  const renamed = new Map(current.filter((level) => nextById.has(level.id) && nextById.get(level.id) !== level.title).map((level) => [level.title, nextById.get(level.id)]));
  const adjust = (item) => (deleted.has(item.category) ? null : renamed.has(item.category) ? { ...item, category: renamed.get(item.category) } : item);
  return {
    words: content.words.map(adjust).filter(Boolean), grammar: content.grammar.map(adjust).filter(Boolean), challenges: content.challenges.map(adjust).filter(Boolean),
    combos: content.combos.map(adjust).filter(Boolean), stories: content.stories.map(adjust).filter(Boolean),
    order: nextList.map((level) => String(level.title || "").trim()).filter(Boolean),
    renames: renamed.size ? { words: [], categories: [...renamed].map(([from, to]) => ({ from, to })) } : null,
  };
}

// The levels editor's list without one level (deleting a category deletes its items, through editedLevels).
export const levelListWithout = (levelOrder, title) => levelOrder.filter((t) => t !== title).map((t) => ({ id: `cat-${t}`, title: t }));

export const hasRenames = (renames) => !!renames && (renames.words.length > 0 || renames.categories.length > 0);

// What goes to the server with the next content save (content_save_v2 moves every player's progress).
export const pendingOf = (renames) => [...renames.words.map((r) => ({ kind: "word", from: r.from, to: r.to })), ...renames.categories.map((r) => ({ kind: "category", from: r.from, to: r.to }))];

// Keys of a progress map moved from old to new names; a key is not moved over an existing one (the old is dropped).
export function movedKeys(obj, map) {
  const next = { ...obj };
  for (const [from, to] of map) { if (from in next) { if (!(to in next)) next[to] = next[from]; delete next[from]; } }
  return next;
}

// Confusion pairs ("a|b") renamed on both sides.
export function renamedConfusions(confusions, wmap) {
  const c = {};
  for (const [key, val] of Object.entries(confusions || {})) { const [a, b] = key.split("|"); c[`${wmap.get(a) || a}|${wmap.get(b) || b}`] = val; }
  return c;
}

// Category renames as level-id renames ("cat-<title>").
export const levelIdMap = (categoryRenames) => new Map(categoryRenames.map((r) => [`cat-${r.from}`, `cat-${r.to}`]));

export const renamedClearedLevels = (levelsCleared, cmap) => [...new Set(levelsCleared.map((id) => cmap.get(id) || id))];
