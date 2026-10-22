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
- The game's own entry for the word (`V2.findWord`, if any) and the lesson the player is on are sent with the
  question, so the answer explains the game's meaning (see below).
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
  text…"), no usable gap ("This card has no usable gap sentence. Ask again before adding."), or the first problem
  from `V2.validateContent` against the live content ("Cannot add this card: …").
- Otherwise the word is added to the custom words, the game's content is rebuilt (`setGameContent`), `dataVersion` is
  bumped (the content save follows), the card switches to "Already in your collection", a toast says
  "<word> added to your collection", and the word is kept in the admin's library (`keepInLibrary`, best effort).

## The question and the answer

**Implemented** (2026-10-22). The term check, what is sent, the instructions and the answer check are in
[askAiCard.js](../../../src/lib/askAiCard.js); `askAiForWordImpl` ([aiPrompts.js](../../../src/lib/aiPrompts.js))
calls the AI with them. Callers: the drawer (`useAskAi`), the word editor's "Fill empty fields with AI" and Words →
"Fill stubs with AI" (admin). The fields are described in [word-fields.md](../content/word-fields.md).

The task name, permissions, cancelling, time limits, quota, model and drawer did not change.

**Why it changed.** These problems were found by reading the earlier code:
- The game's meaning was ignored. For a word with several meanings, the answer could explain another meaning.
- The whole entry was sent, including a drawing of up to 12,000 characters.
- Answer fields reached the drawer unchecked. A text in `nearWords` made the drawer fail to render (shown with the old
  code in a test run).
- A good explanation was refused when its unseen gap had no blank. A gap or hint that gave the word away was
  accepted.
- "café" became "caf".

1. **Checked before any AI call** (no quota is used). The term loses non-letters at its ends; inner spaces become
   single; it is cut to 80 characters. Then:
   - empty → "Select or type an English word first.";
   - letters from another alphabet → "Type the word in English letters.";
   - more than 8 words → "Ask about one word or a short phrase.";
   - accented letters are kept.
2. **What is sent** (`askAiInput`): `term`; `gameEntry`; `topic`.
   - `gameEntry` holds only `word`, `type`, `partsOfSpeech`, `meaning`, `situation`, `category` and `opposite`, with
     long texts shortened.
   - A stub (`_autoStub`) sends only its word and opposite, because its meaning and type are placeholders.
   - `topic` is the lesson the player is on, sent by the drawer only. The admin screens send their entry and no topic.
3. **The instructions** (`ASK_AI_INSTRUCTIONS`):
   - Explain one meaning for a B1 learner, in this order: the game's meaning, else the meaning that fits the topic,
     else the most common one. Every field must be about that meaning.
   - Use the dictionary form ("went" → "go", "recieve" → "receive").
   - Field rules:
     - `type`: phrasal, idiom or binomial; never `fyi`.
     - `partsOfSpeech`: only from the game's list.
     - `meaning`: does not contain the word.
     - `situation`: a natural example.
     - `gap`: a different sentence with exactly one blank, where the word fits as written.
     - `hints`: do not give the word away.
     - `nearWords`: real confusions only, or none; no false synonym or opposite.
     - `commonMistake`: a real one, or null; never invented.
   - Input that is not an English word or phrase gets `{"status":"invalid","reason","suggestion"}`.
4. **The answer** (`readAskAiAnswer`). The card holds only these fields; nothing else from the answer reaches the
   drawer or the content.

   | The answer | What happens |
   | --- | --- |
   | Cannot be read | "AI returned an unreadable answer. Please try again." |
   | No `meaning` or `situation` | "AI returned an incomplete explanation. Please try again." |
   | `status: "invalid"` | "“<term>” doesn't look like an English word or phrase.", plus "Did you mean “…”?" when the suggestion is a different word in English letters. |
   | There is a game entry (not a stub) | Its `word`, `type`, `partsOfSpeech` and `category` are kept. |
   | `type` | One of the five types or a common name for one ("phrasal verb" → `phrasal`), else `vocab`. |
   | `partsOfSpeech` | Only values from the game's list, at most 3. |
   | `gap` | Must have exactly one blank and must not show the word or a regular form of it. Otherwise it is left empty: the explanation is still shown, and "Add to Collection" says "This card has no usable gap sentence. Ask again before adding." |
   | `hints` | Hints that show the word are dropped; at most 3 are kept. |
   | `nearWords` | Each needs a word and a difference as text, and is not the word itself; at most 3. |
   | `commonMistake` | Kept only with all three texts and a correction that differs from the sentence. |
   | `pronunciation` | Short text, or empty. |
   | No category | "AI Discoveries". |

**Limits.**
- With no game entry and no topic, a word with several meanings gets the most common one, and the drawer shows that
  one only.
- A word asked from a sentence (clicked in a question or story) does not send that sentence. Sending it, and
  showing other meanings in the drawer, would change the drawer and the round's interface, so they were left for a
  later decision.
- The check that a sentence shows the word recognises regular forms (rain, rained, raining) but not irregular ones
  (go, went).

## Pronunciation

`listenTerm` holds the text of the open pronunciation window (`PronunciationModal`); the header's speaker and the
drawer's "Listen" set it, closing clears it.

## Tests

| What | Where |
| --- | --- |
| The steps with no state: the term, the category, the entry, the refusals | `tests/ask-ai-rules.test.js` |
| The term check, what is sent, the instructions, the answer check; the fixed cases with made-up AI replies | `tests/ask-ai-card.test.js`, cases in `tests/askAiCases.js` |
| The same fixed cases against the real model (by hand only: `ASK_AI_EVAL=1` and `GEMINI_API_KEY`; skipped in CI) | `tests/ask-ai-eval.test.js` |
| The hook and drawer: asking (with the topic), stale answers dropped, closing cancels, Escape, adding (admin only, refusals, library), Listen, a badly shaped answer still shows | `tests/ask-ai-hook.test.jsx` |
| The drawer in a browser: the header opens it and asks, the local-mode message, Escape / outside click / close button, the speaker | `e2e/specs/askai.cjs` |
| Only through the index, no loop | `tests/architecture.test.js` |
| The AI call can be cancelled; its task name | `tests/ai-operations.test.js` |
| Pronunciation sources and caching | `tests/pronunciation.test.js`, `tests/listening-background.test.jsx` |

How the behaviour was kept: the steps with no state were moved first, unchanged, and compared with the old shell code
on 3,000 random synthetic cases (one-off, not kept); `askai.cjs` passes on the build before the move and after it.
Deliberate breaks of the rules (5) and of the hook (8) each make a test fail.

**Gaps.** Local mode has no AI, so no browser test sees a real answer or adds a word; that path is tested with the AI
call mocked. The answer check was shown to matter by running the new tests on the old code: a text in `nearWords`
made the drawer fail to render, a good explanation with a bad gap was refused, a gap showing the word was accepted, and
"café" lost its last letter. **No answer from the real model was evaluated** (no key in this environment): the tests
prove the checks, not that the model's answers got better. Opening from a round or from My Library is not tested here (their own specs cover their buttons).
