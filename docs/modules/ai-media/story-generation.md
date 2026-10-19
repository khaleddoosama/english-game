# Story generation (AI & Media)

The admin's "Generate a mixed-category story" on the Stories page (`/stories`): pick categories, let the AI write a
short story that hides chosen words, preview it, then add it to the stories or discard it. Part of the
[AI & Media](README.md) module. The AI call is `generateStory(words, targets, categories, rules)` in [engine/ai.js](../../../src/engine/ai.js) (the hook passes the game's words; task
"Write a story", admin only on the server; it checks the story, retries when a target word leaks into the text, and
checks each grammar question is really in the story).

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [storyRules.js](../../../src/features/ai-helpers/storyRules.js): `storyPlan({ words, grammar, categories, stories,
  mastery, confusions }, random)` returns `{ targets, grammarRules }` (the choice below), or throws the five-vocab
  message.
- [useStoryGeneration.js](../../../src/features/ai-helpers/useStoryGeneration.js): the chosen categories, the story
  being written, the error, Add / Discard. [StoryBuilder.jsx](../../../src/features/ai-helpers/StoryBuilder.jsx): the
  builder and the preview. Reached only through [index.js](../../../src/features/ai-helpers/index.js).

`useStoryGeneration({ stories, setStories, mastery, confusions, viewKey })` returns `{ categories, error, state,
generate, toggleCategory, add, discard }`. The shell passes `viewKey` = screen and address; its own screen-change
cleanup still cancels every foreground AI task. The Stories list below the builder stays in the shell.

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
| The choice of targets: the five-vocab rule, how many, in turn, fresh and weak first, the other types, grammar rules | `tests/story-rules.test.js` |
| The hook and builder: categories shown (admin only), messages, the call, loading, stale answers (newer request, category change, leaving the page), Add / Regenerate / Discard | `tests/story-generation-hook.test.jsx` |
| The builder in a browser: categories and counts, Generate disabled, the five-vocab rule, the AI asked, a change clears the message | `e2e/specs/storygen.cjs` |
| Only through the index, no loop | `tests/architecture.test.js` |
| The AI call can be cancelled | `tests/ai-operations.test.js` |

How the behaviour was kept: `storyPlan` was moved first, unchanged except that `Math.random` became an argument, and
compared with the old shell code on 1,500 seeded random cases (one-off, not kept); `storygen.cjs` passes on the build
before the move and after it. Deliberate breaks of the rules (8) and of the hook (7) each make a test fail.

**Gaps.** Local mode has no AI, so no browser test sees a real story; that path is tested with the AI call mocked.
The checks inside `generateStory` (leaks, retries, grammar questions) are not part of this slice.
