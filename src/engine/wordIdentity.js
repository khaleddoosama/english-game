// Which word is which. A word is identified by its text, compared without case
// and with spaces collapsed (the game keys progress, views and links by that
// text). "Cast" and "Cast (to throw)" are two words of one headword: different
// texts, so both may exist. No imports: the editor, the app shell and the
// importer can all use it.

const same = (a, b) => String(a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === String(b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// null when `from` may be renamed to `to`; otherwise the sentence to show.
// Renaming never merges two words: a name another word has is refused.
// Changing only the case or the spaces of a word's own name is allowed.
export function renameProblem(words, from, to) {
  if (!String(to ?? "").trim()) return "The word can’t be empty.";
  if (same(from, to)) return null;
  const taken = (words || []).find((w) => same(w?.word, to));
  return taken ? `There is already a word called “${taken.word}”. Choose another name, or edit that word.` : null;
}
