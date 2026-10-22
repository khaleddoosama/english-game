# Module: ai-media

Everything that calls Gemini or handles pictures and sound: the server functions, the quota gate, the prompts, the cancellable AI jobs, pronunciation, and word pictures. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decision: [ADR 0006](../../adr/0006-ai-through-server-functions.md).

## 1. Purpose and scope

**Purpose.** Give learners AI help (explanations, second opinions on answers, new practice sentences) and sound, and give the admin content tools, at a controlled cost and without exposing the API key.

**Responsibilities (Implemented)**

- Server: `/api/ai`, `/api/tts`, `/api/image-import`, `/api/keepalive` and their helpers ([api/](../../../api)).
- Database gate: who may call, which features are admin-only, the daily quota, the call log.
- Browser: the request client with timeout and offline check ([lib/ai.js](../../../src/lib/ai.js)), the cancellable job registry and progress panel ([aiOperations.js](../../../src/lib/aiOperations.js), [AiProgress.jsx](../../../src/features/media/AiProgress.jsx), [aiLifecycle.js](../../../src/lib/aiLifecycle.js)), the prompts and answer parsing ([aiPrompts.js](../../../src/lib/aiPrompts.js); in `engine/ai.js` until 2026-10-21, [ADR 0010](../../adr/0010-ai-prompts-outside-the-engine.md)).
- Pronunciation: a recorded voice from the free service dictionaryapi.dev where available (the browser calls it directly, outside this app's servers), otherwise the shared AI voice cache, otherwise the browser's own speech ([media.jsx](../../../src/features/media/media.jsx)).
- Word pictures: resize to WebP in the browser, store by content hash in a public bucket; copy an outside link into the bucket ([images.js](../../../src/lib/images.js), `/api/image-import`).

**Out of scope**

- What to do with an AI answer (grading, mastery): [learning-engine](../learning-engine/README.md) and [practice](../practice/README.md).
- The admin's AI usage screens ([admin](../admin/README.md)), though the data lives here.

## 2. Public operations

| Operation | Input | Output | Who |
| --- | --- | --- | --- |
| `POST /api/ai` | `{prompt, task}` | `{text, model}` or `{error}` with status 400, 401, 403, 413, 429, 5xx | player or admin; admin-only for some tasks |
| `POST /api/tts` | `{text}` (up to 400 characters) | `{url, cached}` or audio bytes | player or admin; cached clips need no sign-in check |
| `POST /api/image-import` | `{url}` | `{url}` of the stored picture | admin |
| `GET /api/keepalive` | cron | health numbers | cron secret if set |
| `callAiText(prompt, {task, signal})` (posts with `postAiRequest`, inside `lib/ai.js`) | prompt, task | text | browser |
| `managedAiFunction(label, fn, arity)` / `runAiOperation` | | a function that shows progress and can be cancelled | browser |
| `cancelAiTasks(labels?, {includeBackground})` | | none | browser |
| `speechUrl(text)`, `PronunciationModal` (fetches with `fetchWordAudio(term)`, inside `media.jsx`) | | audio URL | browser |
| `uploadWordImage(file)`, `importImageLink(url)` in `images.js` | picture file / link | public URL | admin |
| `ai_gate(admin_only, daily_limit, kind, task, preview, chars)` | | `{ok, reason, call, ...}` | database; called by the function with the caller's token |
| `ai_call_finish(...)` | outcome | nothing | database; server key only |

The task list ([tasks.js](../../../api/_lib/tasks.js)) is the contract between browser and server: player tasks (ask about a word, check a written answer, check another word in a gap, Grammar Court, explain a wrong answer, review a reported question, new combo question, new grammar question, write and check new practice sentences) and admin tasks (fix an import file, suggest a fix for a report, suggest category merges, content health fix, rewrite a word, write a story, write grammar questions).

## 3. Files, screens and database objects

- Screens: the AI progress panel ([AiProgress](../../../src/features/media/AiProgress.jsx)), pronunciation window, Ask AI drawer ([features/ai-helpers](../../../src/features/ai-helpers), guide [ask-ai.md](ask-ai.md)), the Stories page's story builder (same folder, guide [story-generation.md](story-generation.md)); new practice sentences and variants in the background (same folder, guide [pool-generation.md](pool-generation.md)), AI parts of the session view, Import (AI repair), admin content tools, Admin, AI usage.
- Tables: `ai_usage` (calls per player per day), `ai_calls` (one row per call: who, when, kind, task, admin-only, status, reason, model, time, sizes, tokens, a 300-character preview). Buckets: `word-images` (admin writes), `tts` (only the server key writes).
- Functions: `ai_gate`, `ai_call_finish`, `app_setting`; admin side `admin_ai_usage`, `admin_ai_summary`.
- Server settings: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_FALLBACK_MODELS`, `GEMINI_TTS_VOICE`, `PLAYER_DAILY_AI_CALLS`, `SUPABASE_SECRET_KEY`, `CRON_SECRET` (see the top-level README).
- Browser storage: localStorage `wh-tts-urls-v2` (phrase to audio link, newest 400) and `wh-dict-audio` (dictionary lookups, newest 300).

## 4. Business rules and permissions

- The browser never sees the key. The server accepts only listed task names and enforces a per-task prompt size (20,000, 60,000 or 120,000 characters).
- The gate (database) allows a call only for a signed-in user. Admin-only tasks are refused for players. When the admin switches off AI (or voice) for players, players are refused; the admin is not. The daily limit (admin setting, default 150) applies to players, not the admin. Every attempt, allowed or denied, is logged. A call counts against the daily total when the gate lets it through, even if Gemini then fails.
- The log row is finished only by the server (model, time, tokens, outcome); players cannot rewrite it.
- Gemini access: main model, then fallbacks when a model is overloaded (retry once), rate-limited or missing; a total budget of 40 s per call, 15 s per attempt.
- Text to speech: the phrase is hashed with the model and voice; an existing file is returned without any check (it plays even when AI voice is off). New clips need the gate.
- Picture copy: only public internet addresses, 2 MB at most, PNG, JPEG, WebP or GIF verified by the first bytes; stored by content hash.
- Pictures the browser uploads are resized to 512 px on the longest side and stored as WebP (JPEG if WebP is unavailable); only the admin can write the bucket.
- Prompts are written in the browser (see Known Issues).

## 5. Data flow

1. A feature calls a managed function (for example "Check a written answer"). The registry shows a job (phase: preparing, checking the connection, waiting for AI, checking the response).
2. `postAiRequest` checks that the device is online, gets the access token, and posts to `/api/ai` with a 45 s timeout (the job has 50 s).
3. The function validates the task and size, asks `ai_gate` with the caller's token, calls Gemini, writes the outcome with the server key, and returns the text.
4. The browser parses the JSON answer (a tolerant parser) and passes it on. Background jobs (writing new sentences) do not block the screen.
5. Sentences written this way are stored in the player's `pools` progress section (see [practice](../practice/README.md)).

## 6. Failure, retry, cancel, offline

- Offline or local mode: AI calls fail at once with a clear message; the game is playable without AI.
- Timeouts: the request and the whole job are bounded; the message says the AI took too long.
- Cancel: leaving the question, the screen, the drawer or the game cancels the jobs started from it (named tasks); background jobs can be kept or cancelled explicitly. A cancelled job is shown as cancelled, not as a failure.
- Errors map to short messages: 401 session expired, 403 unavailable for your account, 429 allowance reached, 5xx AI unavailable, unreadable answer.
- Where AI is a second opinion (typed answers), failure leaves the answer marked wrong or "AI failed" and out of the evidence; the player can retry.
- Gemini overload: fallbacks are tried; if all are busy the player is asked to try again in a minute.
- If the server key for storage or logging is missing, audio still plays but is not cached, and log rows stay "unfinished".
- Pronunciation: the free dictionary lookup is tried first for single words, with an 8 s limit; "no entry" is remembered. A broken remembered link is forgotten and requested again.

## 7. Tests

| Check | Where |
| --- | --- |
| Route behaviour, task list, gate answers, errors | [tests/api.test.js](../../../tests/api.test.js), [tests/gemini.test.js](../../../tests/gemini.test.js), [tests/tts.test.js](../../../tests/tts.test.js), [tests/image-import.test.js](../../../tests/image-import.test.js) |
| Gate, quota, switches, log, finishing a row | [supabase/tests/ai_calls.sql](../../../supabase/tests/ai_calls.sql), [app_settings.sql](../../../supabase/tests/app_settings.sql) |
| Job registry, timeouts, cancellation, progress panel | [tests/ai-operations.test.js](../../../tests/ai-operations.test.js), [ai-timeout.test.js](../../../tests/ai-timeout.test.js), [ai-progress.test.jsx](../../../tests/ai-progress.test.jsx) |
| Pictures | [tests/images.test.js](../../../tests/images.test.js) |
| New practice sentences and variants | [tests/generation-rules.test.js](../../../tests/generation-rules.test.js), [tests/ai-generation-hook.test.jsx](../../../tests/ai-generation-hook.test.jsx), [e2e/specs/poolgen.cjs](../../../e2e/specs/poolgen.cjs) |
| Story generation | [tests/story-rules.test.js](../../../tests/story-rules.test.js), [tests/story-generation-hook.test.jsx](../../../tests/story-generation-hook.test.jsx), [e2e/specs/storygen.cjs](../../../e2e/specs/storygen.cjs) |
| Ask AI about a word | [tests/ask-ai-rules.test.js](../../../tests/ask-ai-rules.test.js), [tests/ask-ai-card.test.js](../../../tests/ask-ai-card.test.js), [tests/ask-ai-hook.test.jsx](../../../tests/ask-ai-hook.test.jsx), [e2e/specs/askai.cjs](../../../e2e/specs/askai.cjs); real model by hand: [tests/ask-ai-eval.test.js](../../../tests/ask-ai-eval.test.js) |
| Pronunciation | [tests/pronunciation.test.js](../../../tests/pronunciation.test.js), [tests/listening-background.test.jsx](../../../tests/listening-background.test.jsx) |
| AI log screen | [tests/ai-log.test.js](../../../tests/ai-log.test.js) |

**Gaps.** No test calls the real Gemini or the real Supabase gate through the Vercel Functions end to end; the prompts' behaviour is not tested (a model may answer differently over time). For Ask AI only, a fixed set of cases can be run against the real model by hand (`tests/ask-ai-eval.test.js`); it has not been run yet. The usage inventory is in [docs/ai-usage-inventory.md](../../ai-usage-inventory.md).

## 8. Example journey

Mia (synthetic) types "I was reluctant of go" in a typing question for "Reluctant". (Practice, section 7.5 in [current-state.md](../../architecture/current-state.md#75-judge-an-answer).)

1. Exact comparison says wrong. The session view calls "Check another word in a gap" with the prompt, the expected answer and her text. The progress panel shows "Waiting for AI".
2. `/api/ai` validates the task and size, `ai_gate` counts one call (her 41st today of 150) and logs it, Gemini answers, the log row is finished.
3. The AI says the sentence is not natural: the answer stays wrong, with its feedback. If the connection had dropped, the answer would show "AI failed" and be left out of her evidence, with a Retry button.
4. If she left the question before the answer came back, the job is cancelled and the late answer is ignored.

## 9. Status

**Implemented.** Everything above.

**Planned**

- Phase 2: a rule for AI-written sentences that did not pass the quality check.
- Phase 3: decide whether free-text prompts should be restricted.

**Known Issues**

- `LC-02` when the quality-check AI call fails, sentences that pass only the local checks (length, a blank, the answer not given away) are still added to the player's pool.
- `PE-04` the server forwards any prompt text within the size limit, so a signed-in player can use the AI as a general chat within the daily quota.
- The usage inventory ([ai-usage-inventory.md](../../ai-usage-inventory.md)) was re-checked on 2026-10-22; its "Ways to improve" list holds the problems found in the other prompts (not changed).
