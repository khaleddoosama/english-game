# Ask AI about a word (AI & Media)

The "Ask AI" drawer: look up a word or short phrase, read a simple explanation, hear it, and (admin) add it to the
course. Part of the [AI & Media](README.md) module. The AI call itself is `askAiForWord` in
[lib/aiPrompts.js](../../../src/lib/aiPrompts.js) (task "Ask AI about a word", cancellable, 50 s limit); the voice is
`PronunciationModal` in [media.jsx](../../../src/features/media/media.jsx).

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [askAiRules.js](../../../src/features/ai-helpers/askAiRules.js): the steps with no state: `askTerm`,
  `contextCategoryOf`, `aiWordEntry`, `aiWordProblem`.
- [useAskAi.js](../../../src/features/ai-helpers/useAskAi.js): the drawer's state, the question, adding the word, and
  the pronunciation term. [AskAiDrawer.jsx](../../../src/features/ai-helpers/AskAiDrawer.jsx): the drawer and the
  pronunciation window. Reached only through [index.js](../../../src/features/ai-helpers/index.js)
  (`tests/architecture.test.js`).

`useAskAi({ isAdmin, gameContent, setGameContent, liveContent, content, set, contextCategory, onWordAdded })` returns `{ open, setOpen, term, setTerm,
listenTerm, setListenTerm, result, busy, error, openAskAi, runAskAi, addAiWord }`. The shell keeps the header's ask
bar (it uses `term`, `openAskAi` and `setListenTerm`), passes `openAskAi` to the round and to My Library as before,
passes `contextCategoryOf(currentLevel, activeSession)` and, as `onWordAdded`, `keepInLibrary(library, entry)`.
The game's copy comes through `gameContent` / `setGameContent` from the shell ([content-catalog.md](../content/content-catalog.md)).
Depends on the engine (`v2`, `data`, `ai`), `features/media` (`PronunciationModal`) and `lib` (`aiOperations`).

## Where it opens

| From | How |
| --- | --- |
| The header's ask bar (every screen with the header) | type a word, then Enter or "Ask AI"; the speaker button opens the pronunciation window for the typed text |
| A round (`SessionView`, `onAskWord`) | a word in a question |
| My Library (`LibraryRoutes`, `onAskWord`) | "Ask AI about it" when the dictionary has no such word, and the chips of pasted words that are missing |

`openAskAi(term)` opens the drawer and clears the last answer and error. The term is trimmed, inner spaces are made
single, and it is cut to 80 characters; when it is not empty, the question is asked straight away.

## Asking (`runAskAi(term)`)

- Nothing happens for an empty term.
- A new question cancels the one still running (the task "Ask AI about a word") and clears the last answer and error.
- The game's own entry for the word (`V2.findWord`, if any) is sent with the question, so the answer keeps its parts of
  speech.
- The answer is shown with "Already in your collection" when the game already has the word (the asked one or the one
  the AI returned).
- An answer or an error that arrives after a newer question, or after the drawer closed, is dropped (`askAiEpoch`).
- On an error the drawer shows its message (or "AI explanation is unavailable. Try again."). In local mode every AI
  call fails at once with "AI features need the online version. Sign in on the deployed site."

## Closing

Escape, a click outside the card, or the close button. Closing cancels the running question and stops the busy state.
Changing screen or address cancels every foreground AI task (the shell's screen-change cleanup), this one included.

## Adding the word (`addAiWord`, admin only)

The "Add to Collection" button is shown to the admin only, and not when the word is already in the collection.
`addAiWord` also does nothing for a player (before the move only the hidden button kept a player out).

- The category is the one the player is on (the current level's title, or a practice round's title), else the AI's
  category, else "AI Discoveries".
- The new entry keeps `word`, `type`, `partsOfSpeech` (when any), `category`, `meaning`, `situation`, `gap`, `hints`,
  `commonMistake` (when given) and `_aiAdded: true`.
- Refused, with the reason in the drawer: any Arabic letter in the entry ("The generated card contains non-English
  text…"), or the first problem from `V2.validateContent` against the live content ("Cannot add this card: …").
- Otherwise the word is added to the custom words, the game's content is rebuilt (`setGameContent`), `dataVersion` is
  bumped (the content save follows), the card switches to "Already in your collection", a toast says
  "<word> added to your collection", and the word is kept in the admin's library (`keepInLibrary`, best effort).

## The question and the answer: Planned (2026-10-22)

**Planned.** Not in the code yet. The current prompt and checks are in `askAiForWordImpl`
([aiPrompts.js](../../../src/lib/aiPrompts.js)). The fields it fills are described in
[word-fields.md](../content/word-fields.md).

Problems with the current code, found by reading it:

- **The game's meaning is ignored.** Only the parts of speech of the game's entry are kept. For a word with several
  meanings, the answer can explain a different meaning from the one the player is learning. The editor's "Fill empty
  fields with AI" can also write an example for a different meaning from the one the admin typed.
- **The whole entry is sent.** This includes a picture link or drawing (up to 12,000 characters), so a prompt can come
  close to the task's 20,000-character limit.
- **Fields are shown without checks.** `nearWords`, `pronunciation` and any other field of the answer are passed to
  the drawer as they come. If `nearWords` is not a list, or a difference is not text, the drawer fails to render.
- **Some answers are refused for no reason, others are accepted when they should not be.** A good explanation is
  refused when its gap sentence has no blank, even though the drawer never shows the gap. A gap that gives the word
  away, or has two blanks, is accepted. Hints that contain the word are kept. An unknown type silently becomes
  `vocab`, and unknown parts of speech are kept.
- **Unclear input is not handled.**
  - Random letters or a whole sentence is sent to the AI, which explains something anyway.
  - A word in Arabic letters becomes an empty term, which is caught.
  - A word with an accent at the end loses its last letter ("café" becomes "caf").
- **Placeholder text is treated as real.** A stub's placeholder meaning ("Imported reference — needs a real
  definition.") would be sent as if it were the real meaning.

The change (`src/lib/askAiCard.js`, used by `askAiForWordImpl`). Task name, permissions, cancelling, time limits,
quota, model and the drawer stay as they are.

1. **Checked before any AI call** (no quota is used):
   - the term is cut to 80 characters, as now;
   - empty → "Select or type an English word first." (as now);
   - letters from another alphabet → "Type the word in English letters.";
   - more than 8 words → "Ask about one word or a short phrase."
2. **What is sent:** `term`; `gameEntry`, holding only `word`, `type`, `partsOfSpeech`, `meaning`, `situation`,
   `category` and `opposite` (the texts shortened); and `topic`.
   - For a stub (`_autoStub`), only its word and opposite are sent: its meaning and type are placeholders.
   - `topic` is the lesson the player is on (`contextCategory`). It is passed by the drawer only; the admin
     screens keep their calls as they are.
3. **The prompt.**
   - Explain one meaning for a B1 learner: the game's meaning when there is one, else the meaning that fits the
     topic, else the most common one. Every field must be about that meaning.
   - Use the dictionary form ("went" → "go", "recieve" → "receive").
   - Rules for each field:
     - `type`: when to use phrasal, idiom or binomial; the AI never uses `fyi`, which is the course's own label.
     - `partsOfSpeech`: chosen only from the game's list.
     - `meaning`: does not contain the word.
     - `situation`: a natural example.
     - `gap`: a different sentence, with exactly one blank where the word fits as written.
     - `hints`: do not give the word away.
     - `nearWords`: real confusions only, or none.
     - `commonMistake`: a real, typical mistake, or null. Never invented.
   - For input that is not an English word or phrase, the answer is
     `{"status":"invalid","reason","suggestion"}`.
4. **Checks on the answer** (`readAskAiAnswer`).
   - A reply that cannot be read, or has no `meaning` or `situation`: a clear error. Nothing is shown or saved.
   - `status: "invalid"`: the error "“<term>” doesn't look like an English word or phrase." and, when the AI
     suggests one, "Did you mean “…”?"
   - With a game entry, the result keeps the game's `word`, `type`, `partsOfSpeech` and `category`.
   - Without one:
     - `type` is accepted from the five types or a few common names for them ("phrasal verb" → `phrasal`), else
       `vocab`;
     - `partsOfSpeech` keeps only values from the game's list.
   - A gap without exactly one blank, or that contains the word: the gap is dropped (empty).
     - The explanation is still shown.
     - "Add to Collection" is refused with "This card has no usable gap sentence. Ask again before adding."
     - The admin screens' own content checks refuse it too.
   - Hints that contain the word are dropped, and at most 3 are kept.
   - `nearWords`: at most 3 entries, each a word and a difference in text, never the word itself.
   - `commonMistake`: three texts, and the correction differs from the sentence; otherwise it is left out.
   - `pronunciation`: short text, or nothing.
   - The result has only these fields. Nothing else from the answer reaches the drawer or the content.
5. **Evaluation.**
   - A fixed set of synthetic cases (`tests/askAiCases.js`): a word with several meanings, an idiom, a phrasal verb,
     an unclear word with no context, random letters, Arabic letters and a whole sentence.
   - Tests use made-up AI replies: what is sent, what is accepted or refused, and the errors.
   - `tests/ask-ai-eval.test.js` runs the same cases against the real model. It runs only by hand, with
     `ASK_AI_EVAL=1` and `GEMINI_API_KEY`, and is skipped in CI.

## Pronunciation

`listenTerm` holds the text of the open pronunciation window (`PronunciationModal`); the header's speaker and the
drawer's "Listen" set it, closing clears it.

## Tests

| What | Where |
| --- | --- |
| The steps with no state: the term, the category, the entry, the refusals | `tests/ask-ai-rules.test.js` |
| The hook and drawer: asking, stale answers dropped, closing cancels, Escape, adding (admin only, refusals, library), Listen | `tests/ask-ai-hook.test.jsx` |
| The drawer in a browser: the header opens it and asks, the local-mode message, Escape / outside click / close button, the speaker | `e2e/specs/askai.cjs` |
| Only through the index, no loop | `tests/architecture.test.js` |
| The AI call can be cancelled; its task name | `tests/ai-operations.test.js` |
| Pronunciation sources and caching | `tests/pronunciation.test.js`, `tests/listening-background.test.jsx` |

How the behaviour was kept: the steps with no state were moved first, unchanged, and compared with the old shell code
on 3,000 random synthetic cases (one-off, not kept); `askai.cjs` passes on the build before the move and after it.
Deliberate breaks of the rules (5) and of the hook (8) each make a test fail.

**Gaps.** Local mode has no AI, so no browser test sees a real answer or adds a word; that path is tested with the AI
call mocked. Opening from a round or from My Library is not tested here (their own specs cover their buttons).
