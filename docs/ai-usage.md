# Where and how AI is used

AI is **Google Gemini**. The browser never holds the key: every call goes
through a Vercel Function that first asks the database if the call is allowed.
This doc was checked against the code (see also the older Arabic list in
[ai-usage-inventory.md](ai-usage-inventory.md)).

## 1. The path of one AI call

```
UI (WordHunter.jsx / SessionView.jsx / admin)
  → engine/ai.js          builds the prompt, e.g. askAiForWord()   (managedAiFunction wrapper)
  → lib/ai.js callAiText  POST /api/ai {prompt, task}  + Bearer token, 45 s timeout
  → api/ai.js
       1. aiTask(name)            unknown task → 400; prompt longer than maxChars → 413
       2. gate()  → RPC ai_gate   signed in? admin-only? AI off? daily quota?  (inserts an ai_calls row)
       3. generateJsonText()      Gemini, JSON mode, thinkingLevel "low", temperature 0.7
       4. finishCall()            server (secret key) writes model, ms, tokens, status
  ← { text, model }
  ← engine parses JSON (parseJsonLoose / extractFirstJsonValue) and validates the shape
```

### Safety and limits

| Layer | Rule |
|---|---|
| Task list | `api/_lib/tasks.js` — a name that is not listed is refused. `adminOnly` is decided **here**, not by the browser |
| Prompt size | `maxChars`: 20 000 (checking one answer), 60 000 (batch of sentences), 120 000 (admin tools) |
| Gate (`ai_gate`) | `aiForPlayers` switch, `aiDailyLimit` (admin setting; env `PLAYER_DAILY_AI_CALLS` = 150 is the fallback), the admin has no quota. Voice has its own switch `ttsForPlayers` |
| Gemini calls (`api/_lib/gemini.js`) | main model, then `GEMINI_FALLBACK_MODELS`; 2 attempts per model; 503/500/502/504 → short retry; 429 → next model at once; 404 → skip; total budget **40 s**, 15 s per attempt (function limit is 60 s) |
| Browser | `AI_REQUEST_TIMEOUT_MS = 45 000`; each task has its own timeout in `managedAiFunction` (most 50 s, `Write new practice sentences` 100 s, `Write a story` 150 s); offline and local-mode are refused early |
| Logging | Admin → AI usage shows every call (also denied ones): who, task, `preview` (the INPUT JSON part, 300 chars), model, time, tokens |

### The client wrapper (`src/lib/aiOperations.js`)

`managedAiFunction(label, impl, arity, {background, timeoutMs})` wraps each AI function so the UI can show progress (`AiProgress.jsx`), **cancel** it (`cancelAiTasks`), and so a nested call (generate → validate) shares one cancel signal. Errors are turned into friendly text by `describeAiError` (401 expired session, 403 not allowed, 429 allowance reached, ≥500 unavailable). Components call `useCancelAiOnLeave` so leaving a page cancels its jobs. Late answers from a closed dialog are ignored.

## 2. Every AI task

18 text tasks (`AI_TASKS`) + voice + one non-AI admin gate.

### Player tasks (11)

| Task name | What the AI does | Triggered from | Function |
|---|---|---|---|
| Ask AI about a word | explains a word: meaning, example, gap, pronunciation text, near words and differences, common mistake, hints | word lookup, "Ask AI" inside a question, tapping a word in a question/story; also admin Word editor and "AI fill" in Words | `askAiForWord` |
| Check a written answer | judges a typed sentence / free answer (meaning, grammar, naturalness); accepts valid forms different from the model | typing questions marked `modelOnly` (Idiom Detective meaning, Phrasal Transform, sentence checks) | `evaluateFreeForm` |
| Check another word in a gap | decides if the player's different word also makes the gap sentence correct | a typed gap answer that differs from the model answer (the adaptive builders set `allowAlternativeGap` at difficulty ≥ 5) | `evaluateAlternativeGap` |
| Check a final case report | scores each required word's real use in the player's final text | Final Case at the end of a lesson | `evaluateFinalReport` |
| Grammar court | judges a typed correction; accepts any correct fix | `grammarFix` / Grammar Court typing | `evaluateGrammarCorrection` |
| Explain a wrong answer | short contrast between the chosen word and the right word | after a wrong choice (runs as a background operation) | `explainWrongLead` |
| Review a reported question | decides if the reported question is flawed, duplicate, fine or unclear; checks the learner's answer; may suggest a fix | "Report question" in a round; Admin → Reports | `reviewReportedQuestion` |
| New combo question | writes a new situation+prompt for a word pair | background, after a combo variant is used up | `generateComboVariant` |
| New grammar question | writes a new choose-question for a rule, avoiding used prompts | background, `keepGrammarFresh` after a grammar question | `generateGrammarVariant` |
| Write new practice sentences | new `gap` / `situation` / reworded `meaning` sentences for (word, pool) pairs | background, `triggerGeneration` when a pool has no fresh item (after 2 correct answers), and when a round starts with exhausted pools | `generateContent` |
| Check new practice sentences | quality control of the above: vague, broken, leaks answer, ambiguous, siblings fit | automatically inside `generateContent` (if this call fails, only local checks are used and a warning is shown) | `validateGeneratedContent` |

### Admin-only tasks (7)

| Task name | What the AI does | Where | Function |
|---|---|---|---|
| Fix an import file | repairs JSON that failed validation and lists the changes | Import & export | `aiFixImportJson` |
| Suggest a fix for a report | a small content change that fixes a reported question (keeps `word`/`id`) | Admin → Reports | `suggestReportFix` |
| Suggest category merges | groups categories that mean the same | Admin → Categories | `suggestCategoryMerges` |
| Content health fix | fixes weak meaning, duplicate definitions, missing common mistake / parts of speech, checks gap ambiguity | Admin → Content health | `aiFixWordBatch` |
| Rewrite a word | new meaning + example for a word (shown as a suggestion) | new-word card "Regenerate meaning & example" (needs edit rights) | `regenerateWordExplanation` |
| Write a story | B1 mystery story + questions + grammar questions for chosen words; local checks and retries | Stories screen | `generateStory` |
| Write grammar questions | choose / judge / fix questions for a rule and chosen words | Admin → Grammar editor | `generateGrammarQuestions` (`editors/grammarRules.js`) |

### Voice

`speechUrl(text)` (`lib/ai.js`) → `POST /api/tts` → `speak()` (Gemini TTS, raw PCM wrapped as WAV). Flow in `api/tts.js`:

1. text ≤ 400 chars; hash = sha256(`model|voice|lowercase text`) → file `v2/<hash>.wav`.
2. If the public file already exists → return its URL (**no gate, no cost**, works even if AI voice is off).
3. Otherwise gate (`kind: tts`), Gemini TTS (voice `Kore`, model chain `GEMINI_TTS_*`), upload with the secret key (`x-upsert: false`), return the URL.
4. The browser remembers URLs in `localStorage` (`wh-tts-urls-v2`, 400 newest) and in memory. `media.jsx` also has non-AI pronunciation: dictionary recordings and browser `speechSynthesis`.

### Not AI (do not count)

- Live Challenge (questions, answers, ranking) — **no AI at all**.
- Friends, invitations, leaderboard.
- Normal choosing/typing grading (`V2.grade`), mastery, progress.
- `/api/image-import` (admin): uses the gate and the log (task `Copy a picture link`) but only downloads a picture (max 2 MB, public addresses only, bytes must really be PNG/JPEG/GIF/WebP).

## 3. Background generation (how pools grow)

1. Each word has pools per style (`meaning`, `gap`, `situation`, `typing`) whose first item is the authored `seed`.
2. After an answer the used item gets `attempts+1` (and `correctCount+1` if independent-correct). At 2 correct → `lockedUntil = +7 days`.
3. If no unlocked item is left (`poolNeedsGeneration`), or the word was answered correctly and no *other* fresh item exists → `triggerGeneration([{word, poolType}])`.
4. `generateContent` builds one request per pair with the word's meaning, category, **siblings** (other words of the category with meanings — so the AI avoids sentences where a sibling also fits) and existing texts (to avoid repeats).
5. Local check (`localGeneratedVariantCheck`): 8–420 chars; gap must contain `______` and not the word; others must not contain the word; situation ≥ 6 words.
6. AI check (`validateGeneratedContent`): keeps only `valid: true` with `high|medium` confidence.
7. Accepted texts are added as `gen-…` pool items. A failure only logs to the console: the game keeps reusing what it has.
8. Grammar rules and combos use the same idea with `pools['grammar:<id>'].variant[]` (max 20 per rule, a failed try waits 10 minutes).

## 4. How to add a new AI feature (checklist)

1. Add the task to `AI_TASKS` in `api/_lib/tasks.js` (`adminOnly`? `maxChars`).
2. Write the function in `src/engine/ai.js`, using `callAiJson` (or `callAiJsonAdmin`) with `{task: "<same name>"}`, and export it through `managedAiFunction("<same name>", impl, arity, {background, timeoutMs})`.
3. Validate the JSON shape yourself (never trust the model): see `validateEvaluation`.
4. Show progress/cancel in the UI; handle failure with a safe fallback (never block learning).
5. Add a test in `tests/ai-*.test.js` (timeouts, failure, cancel).
6. Add the row to this doc.

## 5. Cost and risk notes

- Biggest consumers are background variants (`Write new practice sentences` + its check = 2 calls per batch). The daily quota counts every gate call, including the checks.
- Prompts contain only word data and the learner's answer. No names or emails are sent. The log keeps a 300-char preview of the input (admin-only table).
- A busy Gemini (503/429) is handled by fallback models; if all fail the player sees "The AI is very busy…".
- Models and voice are env variables (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_FALLBACK_MODELS`, `GEMINI_TTS_VOICE`). Changing the TTS model/voice changes the hash, so audio is regenerated.
- Ideas for later: cache `Ask AI about a word` results per word (the Listen lookup already remembers results); move pool generation to a nightly admin job to remove background calls from players.
