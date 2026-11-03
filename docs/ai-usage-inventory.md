# AI usage inventory

Every AI call the app makes. For each call it lists:
- where it starts and who may use it;
- where the prompt is built and called;
- what goes in and what is expected back;
- how the answer is checked, and how it is used or saved.

Last review: 2026-10-22, by reading the code on `master` (`bb929c1`) plus the Ask AI change of the same date. It
replaces the earlier inventory of 2026-10-07, written in Arabic at commit `f2a2b0d`.

Status: **Implemented** (a description of the current code). The ideas under "Ways to improve" are **Planned**
only in the sense of proposals. None was made, except for Ask AI.

## Summary

- `api/_lib/tasks.js` lists **17 text tasks**: 10 for players and 7 for the admin only. Text-to-speech is a
  separate route.
- Two of the player tasks have **no caller** in the app: "Grammar court" and "Explain a wrong answer". The server still
  accepts them.
- Removed since the last inventory:
  - "Final Case" (removed 2026-10-20);
  - the personal-library endpoints `api/library-word.js` and `api/library-grammar.js`, which existed only on a branch
    and are not on `master`;
  - the old "screen problem" notes. The client now has a 45 s request limit and a 50 s job limit, the server a 15 s
    limit per attempt and 40 s in total, and the report window can be closed while it waits.
- The callers moved out of `WordHunter.jsx` into hooks: `useAskAi`, `useAiGeneration`, `useStoryGeneration`,
  `useQuestionReports`, `useDataTransfer`.

## The shared path

1. A function in [aiPrompts.js](../src/lib/aiPrompts.js) builds the prompt: instructions, then `INPUT JSON:` and the
   input.
   - `callAiJsonAdmin` only adds `adminOnly`, which the server ignores.
   - The admin's grammar writer is in [grammarRules.js](../src/features/admin/editors/grammarRules.js).
2. `callAiText` ([ai.js](../src/lib/ai.js)) posts `{prompt, task}` to `/api/ai`.
   - It refuses at once when offline or in local mode.
   - Limits: 45 s for the request, and 50 s for the job unless the job sets its own (`managedAiFunction`).
3. [api/ai.js](../api/ai.js):
   - an unknown task gets 400, a prompt over the task's size gets 413;
   - `gate()` checks sign-in, admin-only, the AI switch and the daily quota, and logs the call;
   - Gemini is asked for JSON;
   - the log row is finished.
4. The answer is parsed by `parseJsonLoose`, which strips code fences and takes the first complete JSON value. Errors
   become short messages (`describeAiError` in [aiOperations.js](../src/lib/aiOperations.js)).
5. A job started inside another job runs as part of it: the outer job's time limit applies.

Who may call a task is decided by the server from its name ([tasks.js](../api/_lib/tasks.js)), never by the browser.

## Player tasks

| # | Task and where it starts | Prompt built / called | Input | Expected answer | Checks on the answer | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Ask AI about a word.** Header ask bar; a word clicked in a question or story; "Ask AI" in My Library; admin: word editor "Fill empty fields with AI", Words "Fill stubs with AI". Foreground, 50 s. | `askAiForWordImpl` using [askAiCard.js](../src/lib/askAiCard.js); called by `useAskAi`, `WordEditor`, `Words` | term (checked first), the game's entry (meaning fields only), the lesson topic | `status`, `word`, `type`, `partsOfSpeech`, `category`, `meaning`, `pronunciation`, `situation`, `gap`, `hints`, `nearWords`, `commonMistake`; or `status: "invalid"` | Full check of every field (`readAskAiAnswer`, see [ask-ai.md](modules/ai-media/ask-ai.md)). A clear error for unreadable, incomplete or invalid answers. | Shown in the drawer. Admin add: a new word after `validateContent` and an Arabic check. Editor: fills empty fields. Stubs: saved after `validateContent`. |
| 2 | **Check a written answer.** A free-form question (sentence, idiom meaning, grammar fix, phrasal transform) in a round. Foreground, 50 s. | `evaluateFreeFormImpl`; `SessionView` | kind, target word, its meaning, situation, expected answer, the learner's answer, rules | `correct`, `confidence`, `targetWordUsed`, `semanticUse`, `grammar`, `naturalness`, `spellingIssue`, `feedback`, `suggestedCorrection` | `validateEvaluation`: lists of allowed values, cautious defaults; `correct` is forced false on low confidence, a missing target word, or a meaning-breaking signal; texts capped. Failure: "AI failed", Retry, no progress change. | Saved with the round's answers; `onResult` updates mastery; feedback shown. |
| 3 | **Check another word in a gap.** A typed gap answer that exact matching marked wrong. Foreground, 50 s. | `evaluateAlternativeGapImpl`; `SessionView` | the sentence with the gap, intended word and meaning, the learner's word | same as 2 | same as 2; accepted only when `correct` and `semanticUse` is "correct" | same as 2 |
| 4 | **Grammar court.** No caller. | `evaluateGrammarCorrectionImpl` | rule, explanation, evidence, expected verdict, learner's correction | `correct`, `confidence`, `feedback`, `suggestedCorrection` | `correct` needs high or medium confidence; texts capped | none (Grammar Court questions are graded without AI) |
| 5 | **Explain a wrong answer.** No caller. Background. | `explainWrongLeadImpl` | evidence, chosen and correct word with meanings | `keyDifference` | trimmed, capped | none |
| 6 | **Review a reported question.** "Report question" in a round (and Retry); admin Reports "Ask AI to check" and bulk review. Foreground, 50 s. | `reviewReportedQuestionImpl`; `useQuestionReports`, `Reports` | the report (reason, the learner's own words, mode, prompt, options, answers, learner's answer) and the **whole** source item (`locateReportSource`) | `verdict`, `confidence`, `learnerAnswerAcceptable`, `explanation`, `adminNote`, `fixed`, `changes` | allowed values; `fixed` only for "flawed" with a source, and its key is put back; texts and list capped. Failure: "AI couldn't check it right now", Retry; the report stays. | Stored on the report (player progress). The learner sees the verdict. Admin "Apply fix and resolve" replaces the item. |
| 7 | **New combo question.** A combo variant is used up. Background, 50 s. | `generateComboVariantImpl`; `useAiGeneration` | target words, current situation and prompt, rule explanation | `situation`, `prompt` | both non-empty; no target word in the situation (word-boundary regex). Failure: console, retry after 10 min. | Player `pools["combo:<id>"]` |
| 8 | **New grammar question.** A grammar variant is used up, or a rule has nothing unseen. Background, 50 s. | `generateGrammarVariantImpl`; `useAiGeneration` | rule, explanation, an example question, the last 12 prompts to avoid | `prompt`, `options`, `answer`, `explanation` | 2–4 distinct options; answer among them; not a repeat; one blank when the example has one. Failure as 7. | Player `pools["grammar:<id>"]` |
| 9 | **Write new practice sentences.** A word's unseen sentences are used up (after an answer, at round start, for Live, after a report). Background, 100 s with task 10. | `generateContentImpl`; `useAiGeneration` | per request: word, pool type, meaning, category, every sibling `word = meaning`, every existing text | `[{word, poolType, text}]` | must be a list; then task 10 | Player `pools[word][poolType]` |
| 10 | **Check new practice sentences.** Inside task 9. | `validateGeneratedContentImpl` | locally valid requests with the new text | `{results: [{index, valid, confidence, reason}]}` | Local first: length 8–420; a gap has a blank and not the word; no word in meaning or situation; a situation has 6+ words. Then kept only when `valid` with high or medium confidence. If this call fails, the locally valid texts are kept, with a warning (`LC-02`). | Filters what task 9 saves |

## Admin tasks

| # | Task and where it starts | Prompt built / called | Input | Expected answer | Checks on the answer | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | **Fix an import file.** Import & export, after a failed check. Foreground, 50 s. | `aiFixImportJsonImpl`; `useDataTransfer` | the error lines and the raw text (60,000 characters at most) | `fixed` (the whole file), `changes` | `fixed` present; the caller runs the full import check again | Replaces the text in the box; applied only after the admin chooses a mode and clicks Apply |
| 12 | **Suggest a fix for a report.** Admin Reports, "Suggest a fix". Foreground, 50 s. | `suggestReportFixImpl`; `Reports` | the report and the whole source item | `fixed`, `changes` | `fixed` present | A diff; "Apply fix and resolve" replaces the item |
| 13 | **Suggest category merges.** Admin Categories, "Suggest clean-up". Foreground, 50 s. | `suggestCategoryMergesImpl`; `Categories` | every category name | `{merges: [{canonical, duplicates}]}` | names must exist; empty groups dropped | A list; each "Merge" click renames the category everywhere |
| 14 | **Content health fix.** Admin Content health, "Fix N with AI" per check. Batches of 5, at most 20 words, inside a 240 s job. | `aiFixWordBatchImpl`; `ContentHealthPanel` | per word: word, type, category, meaning, situation, gap or gaps, up to 25 siblings, same-meaning words | `{results: [{word, value, why?}]}` | per kind: Arabic refused; gaps keep their count, one blank each, no word; a situation uses the word; a meaning has 4+ words without the word; a mistake is complete and real; parts of speech from the list | A review list; "Apply" writes the field |
| 15 | **Rewrite a word.** New-word card, "Regenerate meaning & example" (admin only). Foreground, 50 s. | `regenerateWordExplanationImpl`; `SessionView` | word, type, parts of speech, category, meaning, situation | `meaning`, `situation` | both non-empty | A preview; "Use" writes `meaning` and `situation` |
| 16 | **Write a story.** Admin story builder. Foreground, 150 s, up to 3 attempts. | `generateStoryImpl`; `useStoryGeneration` | categories; target words (word, type, category, meaning, situation); up to 2 grammar rules | `title`, `text`, `questions`, `grammarQuestions` | shape; the story must not show a target word (forms included), with swaps and retries; one question per target, not leaking, not dictionary-like; grammar questions dropped one by one when wrong | A preview; "Add" saves the story |
| 17 | **Write grammar questions.** Grammar editor, "Write questions with AI". Foreground, 50 s. | `generateGrammarQuestionsImpl` ([grammarRules.js](../src/features/admin/editors/grammarRules.js)); `GrammarEditor` | rule, explanation, level, examples, existing questions, up to 40 lesson words, count and types | `{questions: [...]}` (choose, judge, fix) | each through `cleanGrammarDraft` and `validateContent`, and of a requested type; failures listed and not selectable | Ticked questions join the draft; saving checks again (Arabic included) |

## Pronunciation (not a text task)

- The Listen buttons call `speechUrl` ([ai.js](../src/lib/ai.js)) → `/api/tts` → `speak` in
  [gemini.js](../api/_lib/gemini.js). This happens only when dictionaryapi.dev has no recording.
- The input is the text, at most 400 characters.
- It uses the same `gate()` (task "Pronunciation", the voice switch, the same daily quota), but not `tasks.js`.
- A phrase already stored is returned before the gate, with no sign-in or quota.
- The answer is audio, stored in the public `tts` bucket. The browser remembers the link.
- `/api/image-import` uses the gate for sign-in and logging only. It makes no AI call.

## Ways to improve (proposals, not done)

Ask AI was improved in this change ([ask-ai.md](modules/ai-media/ask-ai.md)). The other prompts were not changed.
Each point below comes from reading the code.

- **Report fixes are applied without the content checks** (12, and 6 when the admin applies it).
  - "Apply fix and resolve" writes the AI's object with no `validateContent` and no Arabic check.
  - Task 12 does not put the key back. If the AI changes `word` or `id`, nothing is replaced, but the report is still
    marked resolved.
  - In both prompts, `entity.slice(0, -1)` turns "grammar" into "gramma".
- **Whole items are sent** (6, 12).
  - The source item can carry a drawing of up to 12,000 characters, against a 20,000-character limit for task 6.
  - Sending only the text fields would avoid a "too large" refusal. Not seen with real data.
- **Practice sentences** (9, 10).
  - The quality check pairs answers with requests by position, but saving trusts the AI's own `word` and `poolType`.
    An unknown `poolType` would throw while saving.
  - Siblings and existing texts are not capped. Task 14 caps siblings at 25.
  - A gap is checked for a blank, not for exactly one.
  - If the check's JSON has no `results` list, every text is dropped without a message.
- **Unused fields and tasks.**
  - Tasks 2 and 3 ask for `suggestedCorrection` and `spellingIssue`, which nothing uses.
  - Tasks 4 and 5 have no caller. Remove them or wire them up.
- **Rewrite a word** (15) has no check that the meaning avoids the word or that the example uses it, and no Arabic
  check. It updates `situation` but not `situations[0]`.
- **Write a story** (16): "Add" does not run `validateContent` (5–12 targets, 5+ questions), and grammar options have no
  upper limit.
- **New combo question** (7): the leak check builds a regular expression from the word without escaping it and misses
  inflected forms. `storyTextLeaksWord` already handles both.
- **Fix an import file** (11): the AI must echo up to 60,000 characters back within 15 s per attempt. Large files will
  probably time out (inferred, not measured).
- **Any prompt** (`PE-04`): a signed-in player can send any text under a player task, within the daily quota.

## Not AI

- Choices, exact-match grading, mastery and progress.
- Friends, invitations and Live challenges.
- Picture upload and resizing.
- dictionaryapi.dev recordings and the browser's own speech.
- `legacy/word_hunter_v6.3.jsx`: an archived copy, not part of the app (which starts at `src/main.jsx`).
