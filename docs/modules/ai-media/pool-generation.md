# New practice sentences and variants (AI & Media)

In the background, the game asks the AI for new practice text so a player does not see the same sentence again and
again: new sentences for a word's pools, and new variants of a combo or a grammar question. Part of the
[AI & Media](README.md) module. The AI calls are in [engine/ai.js](../../../src/engine/ai.js): `generateContent(words, batch, pools)`
(the hook passes the game's words; task "Write new practice sentences", background, checked by `validateGeneratedContent`), `generateComboVariant`
and `generateGrammarVariant` (checked before they are returned). Nothing here blocks a round: when a call fails, the
game keeps using what it has.

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [generationRules.js](../../../src/features/ai-helpers/generationRules.js): the steps with no state:
  `withGeneratedTexts`, `withVariantItem` (with `comboVariantFields` / `grammarVariantFields`), `grammarVariantAsk`,
  `mayRetryVariant` (`VARIANT_RETRY_MS` = 10 minutes), `idOfKey`, `newItemId`.
- [useAiGeneration.js](../../../src/features/ai-helpers/useAiGeneration.js): what is pending, the failure times, and
  the AI calls. Reached only through [index.js](../../../src/features/ai-helpers/index.js).

`useAiGeneration({ liveContent, poolsRef, setPools, seenSentences })` returns `{ triggerGeneration,
triggerVariantGeneration, keepGrammarFresh, clearPending }`. The shell keeps the calls where they were (after an answer,
starting a practice round, Live Challenge), passes `triggerGeneration` to question reports as before, and Reset
progress calls `clearPending()`.

## Word pools (`triggerGeneration(batch, poolsSnapshot)`)

`batch` is a list of `{ word, poolType }` (`poolType` is one of the word pools, such as `gap`). It is asked for:

| When | What |
| --- | --- |
| After an answer to a word question that came from a pool item (`recordSessionResult`) | that word and pool, when the pool has no fresh item left (`poolNeedsGeneration`), or when the answer was right without help and no other item is still fresh |
| Starting a practice round (`startPractice`) | up to 8 known words in the round whose gap sentences have all been read recently, pool `gap` |
| A Live Challenge's lesson (`refreshLiveSentences`) | up to 8 words whose gap sentences have all been read recently, pool `gap` |
| A reported variant is retired (question reports, `retire`) | that word and pool |

- A pair already being asked for (`word::poolType`) is left out of the new request; nothing is sent when no pair is
  left.
- Each answer with a word the game knows and a non-empty text is added to the end of that word's pool as a new item:
  `{ id: "gen-<time>-<random>", text, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false }`. Answers for
  an unknown word, or with no text, are skipped.
- A failure is only logged ("Content generation failed:"). The pairs are no longer pending afterwards, success or not.

## Combo and grammar variants (`triggerVariantGeneration(poolType, key)`)

`key` is the question's progress key (`combo:<id>` or `grammar:<id>`).

- Asked for after an answer to a variant question, when none of that question's variants is still fresh
  (`recordSessionResult`), and for grammar by `keepGrammarFresh` (below).
- One request per key at a time (`variant::<poolType>::<key>` is pending meanwhile). An unknown combo or rule asks for
  nothing.
- Combo: the variant's `situation` and `prompt` are added. Grammar: the rule, its explanation and the base of the
  question (`V2.grammarVariantBase`) are sent with every prompt already used (the rule's own questions and its
  variants) so the new one differs; its `prompt`, `options`, `answer` and `explanation` are added.
- The new item goes to the end of `pools[key].variant`, with `attempts: 0, correctCount: 0, lockedUntil: null,
  flagged: false`; the pools reference is updated at once.
- A failure is logged ("Variant generation failed:") and remembered for that id (the time of the failure).

## Keeping grammar fresh (`keepGrammarFresh(id)`)

After any grammar question: when the rule will have nothing unseen next time (`V2.grammarNeedsVariant` with the
sentences seen recently), and the last failure for it is more than 10 minutes old, a new grammar variant is asked for.

## Reset

Reset progress clears the pending requests, so a new request can start at once.

## Tests

| What | Where |
| --- | --- |
| The steps with no state: new pool items, variants, the grammar request, the 10-minute wait | `tests/generation-rules.test.js` |
| The hook: sentences added, one request per pair or key, failures only logged, the wait for grammar, unknown ids, Reset | `tests/ai-generation-hook.test.jsx` |
| In a browser: a correct answer asks for a new sentence; local mode's failure is only logged, the round goes on, nothing half-made is saved | `e2e/specs/poolgen.cjs` |
| Only through the index, no loop | `tests/architecture.test.js` |
| `generateContent` / variants check what the AI returns; they can be cancelled | `tests/grammar-variants.test.js`, `tests/ai-operations.test.js` |
| `V2.grammarNeedsVariant`; the next round shows a new variant | `tests/grammar-variants.test.js` |
| Question reports call `triggerGeneration` when a variant is retired | `tests/question-reports-hook.test.jsx` |

How the behaviour was kept: the steps with no state were moved first, unchanged except that the id maker became an
argument, and compared with the old shell code on 2,000 random cases (one-off, not kept); `poolgen.cjs` passes on the
build before the move and after it. Deliberate breaks of the rules (8) and of the hook (8) each make a test fail.

**Gaps.** Local mode has no AI, so no browser test sees a new sentence arrive; that path is tested with the AI calls
mocked. The callers (`recordSessionResult`, `startPractice`, `refreshLiveSentences`) stay in the shell and are covered
only by browser tests (`MT-04`).
