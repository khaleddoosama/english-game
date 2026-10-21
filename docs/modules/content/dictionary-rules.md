# Dictionary rules (content)

The rules about words themselves: how a word is named and found, its senses, which words may not sit together in one
question, antonyms and opposites, links to words that do not exist, renames, and how two sets of content are merged.
Part of the [content](README.md) module (the owner calls it "Dictionary"). No React, no network, no player data.

Status: **Implemented** (current code). The behaviour below was written down before the rules moved out of
`engine/v2.js`; the move kept it (see Tests).

## Files

[engine/dictionary.js](../../../src/engine/dictionary.js) holds the rules below. It imports nothing.
[engine/v2.js](../../../src/engine/v2.js) imports them, uses them, and still offers them on the `V2` object under the
same names (`V2.findWord`, `V2.norm`…), so no caller changed. `healOpposites` and `healMissingWordRefs`
were never on `V2`; they are exported by the dictionary file only (`synonymsOf` is used only inside it). Not moved yet: the v3 file format
(`normalizeV3`, `prepareImport`) and the content checks (`validateContent`), which stay in `engine/v2.js`.

## Names and finding a word

- `norm(text)`: trimmed, inner spaces made single, lower case. Every comparison of names uses it (results are cached;
  the cache is cleared above 20,000 entries).
- `bareWord(text)`: the text without a trailing bracket: "Cast (to throw)" → "Cast".
- `headword(word or text)`: `norm(bareWord(...))`. Two entries with the same headword are two **senses** of one word.
- `findWord(words, name)`: the entry whose name matches `name` after `norm`, or undefined.
- `sensesOf(words, w)`: the other entries with the same headword (never `w` itself, never an entry with the same
  name).

## Words that may not be options together (`compatible(a, b)`)

`false` when: either is missing; they share a headword (two senses read the same); one lists the other in
`excludeFromSameOptionsWith`; or one lists the other (by bare word) in its synonyms (`synonyms`, else
`relations.synonyms`). Otherwise `true`.

## Antonyms and opposites

- `antonymsOf(w)`: the word's `antonyms` that are non-empty text, trimmed.
- `linkAntonyms(words)`: each word's antonyms are its `antonyms` plus its old `opposite` (unless "none"), without
  repeats. An antonym that names another word in the list (exactly, or by headword: then the entry named just that
  headword wins) makes the two words each other's `opposite`; the first link found for a word is kept. Every word's
  old `opposite` is dropped and set again only from these links; a word with antonyms keeps them in `antonyms`.
- `outsideAntonyms(w, words)`: the antonyms that are not words in the list (by name or bare word) and do not contain,
  or sit inside, the word itself — the ones the "Opposite Clue" question can show.
- `healOpposites(words)`: an `opposite` of "none" is removed; an `opposite` that names no word in the list gets a stub
  word (`_autoStub: true`, same type and category, meaning `Opposite of "<word>".`, its opposite pointing back), once
  per missing name.

## Links to missing words (`healMissingWordRefs(content)`)

Every word named in a word's `excludeFromSameOptionsWith`, a combo's `words`, or a story's `targetWords` and its
questions' `targetWord` / `targetWords` that is not a word in the content gets a stub word (`_autoStub: true`, type
`vocab`, the item's category or "General", meaning "Imported reference — needs a real definition."), once per name.

## Renames (`applyRenames(content, renames)`)

`renames = { words: [{ from, to }], categories: [{ from, to }] }`. Nothing changes when both lists are empty. A renamed
word is renamed everywhere it is named: the word itself, `opposite`, `excludeFromSameOptionsWith`,
`relations.confusableWords`, combos' `words`, stories' `targetWords` and questions, challenges' `linkedWords`
(matched with `norm`). A renamed category changes the `category` of words, combos, stories, challenges and grammar
(matched exactly).

## Merging content (`mergeContent(old, incoming)`)

For each list (`words`, `combos`, `stories`, `grammar`, `challenges`; words are keyed by `word`, the others by `id`,
matched with `norm`): an incoming item with a new key is added at the end; one with a known key is merged into the old
one (the incoming fields win, but the old key's spelling stays). Then the words go through `linkAntonyms`,
`healOpposites` and `healMissingWordRefs`. Both sides first lose the fields the game no longer has
(`withoutRemovedFields`: `puns`; a word's `sentenceBuild`, and its `example`, which becomes the `situation` only when it
has none; "build sentence" challenges).

`contentOnly(data)` is the content part of a file or backup: `schemaVersion: 2`, `kind: "content"`, the note (or a
default one), and a deep copy of the five lists.

## Tests

| What | Where |
| --- | --- |
| Every rule above: names, `findWord`, `compatible`, antonyms and opposites (both orders of senses), stubs, renames, merging, removed fields, `contentOnly`; `V2` offers the same functions | `tests/dictionary-rules.test.js` |
| `headword`, `sensesOf`, options never sharing senses, `linkAntonyms` by headword | `tests/senses.test.js` |
| Renames through imports and the content admin | `tests/import-plan.test.js`, `tests/content-admin-rules.test.js` |
| The file imports nothing; only `engine/v2` imports it | `tests/architecture.test.js` |

How the behaviour was kept: the rules were moved line for line (a check found every removed line of `engine/v2.js` in
the new file, and only the import line added); 16 of the new tests passed on the code before the move, and the other
4 test functions `V2` never offered. Deliberate breaks of the rules (12) each make a test fail, except one that changes
nothing (a second guard against adding the same opposite stub twice, already stopped by the name lookup before it).

**Gaps.** `validateContent`, `normalizeV3` and `prepareImport` are still in `engine/v2.js`; they are tested through
imports (`tests/import-export.test.js`, `tests/import-plan.test.js`) but not moved here.
