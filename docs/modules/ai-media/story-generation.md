# Story generation (AI & Media)

The admin's "Generate a mixed-category story" on the Stories page (`/stories`): pick categories, let the AI write a
short story that hides chosen words, preview it, then add it to the stories or discard it. Part of the
[AI & Media](README.md) module. The AI call is `generateStory` in [engine/ai.js](../../../src/engine/ai.js) (task
"Write a story", admin only on the server; it checks the story, retries when a target word leaks into the text, and
checks each grammar question is really in the story).

Status: **Implemented** (current code). This page describes the behaviour as it is; the state and handlers live in
`src/app/WordHunter.jsx`.

## The builder (admin only)

- The categories offered are the level order's categories that have at least one word, each with its word count.
- Ticking or unticking a category cancels a running story ("Write a story"), drops its answer, and clears the preview
  and the error.
- "Generate" is disabled with no category; while a story is being written the button is hidden and "Writing and
  checking a new story…" is shown.

## Choosing what the story hides

1. Words already a target of a story in the stories list go to the back of each category's list (not left out).
   Inside that, the player's weak words come first (`getWeakWordCandidates` on mastery and confusions); ties are in
   random order.
2. At least five vocab words in total in the chosen categories, else "The selected categories need at least five
   vocab words in total." (no AI call).
3. One idiom, one binomial, one FYI and one phrasal verb, when the categories have them: each picked at random among
   the three best (unused first, then weakest). These are on top of the vocab targets.
4. Vocab targets: `min(7, max(5, categories + 3), vocab available)`, taken in turn from each category's list.
5. Up to two grammar rules from the chosen categories (by topic), random, one per rule text.
6. The targets are shuffled and sent with the categories and the rules.

## The answer

- A story or an error that arrives after a newer request, a category change, or leaving the page is dropped
  (`storyAiEpoch`). Leaving the page (any screen or address change) also cancels every foreground AI task and clears
  a story still loading.
- On an error: the message is shown under the builder ("Story generation failed." when it has none). In local mode
  every AI call fails at once with "AI features need the online version. Sign in on the deployed site."
- The preview shows the title, the text, the categories, the hidden targets, and the number of questions (and of
  grammar questions). "Add to My Stories" appends it to the stories (the content save follows) and closes the
  preview; "Regenerate" asks again with the same categories; "Discard" closes it.

## Tests

| What | Where |
| --- | --- |
| The AI call can be cancelled | `tests/ai-operations.test.js` |
| `storyTextLeaksWord` and the story checks inside `generateStory` | `tests/ai-*.test.js` (partly) |

**Gaps (before this slice):** nothing tests the choice of targets, the stale-answer rule, or Add / Discard.
