# New practice sentences and variants (AI & Media)

In the background, the game asks the AI for new practice text so a player does not see the same sentence again and
again: new sentences for a word's pools, and new variants of a combo or a grammar question. Part of the
[AI & Media](README.md) module. The AI calls are in [engine/ai.js](../../../src/engine/ai.js): `generateContent`
(task "Write new practice sentences", background, checked by `validateGeneratedContent`), `generateComboVariant`
and `generateGrammarVariant` (checked before they are returned). Nothing here blocks a round: when a call fails, the
game keeps using what it has.

Status: **Implemented** (current code). This page describes the behaviour as it is; the state and handlers live in
`src/app/WordHunter.jsx`.

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
| `generateContent` / variants check what the AI returns; they can be cancelled | `tests/grammar-variants.test.js`, `tests/ai-operations.test.js` |
| `V2.grammarNeedsVariant`; the next round shows a new variant | `tests/grammar-variants.test.js` |
| Question reports call `triggerGeneration` when a variant is retired | `tests/question-reports-hook.test.jsx` |

**Gaps (before this slice):** nothing tests how new items are added to a pool, the one-request-per-key rule, or the
10-minute wait after a failure.
