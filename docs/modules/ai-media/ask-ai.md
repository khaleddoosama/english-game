# Ask AI about a word (AI & Media)

The "Ask AI" drawer: look up a word or short phrase, read a simple explanation, hear it, and (admin) add it to the
course. Part of the [AI & Media](README.md) module. The AI call itself is `askAiForWord` in
[engine/ai.js](../../../src/engine/ai.js) (task "Ask AI about a word", cancellable, 50 s limit); the voice is
`PronunciationModal` in [media.jsx](../../../src/features/media/media.jsx).

Status: **Implemented** (current code). This page describes the behaviour as it is; the state and handlers live in
`src/app/WordHunter.jsx`.

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

- The category is the one the player is on (the current level's title, or a practice round's title), else the AI's
  category, else "AI Discoveries".
- The new entry keeps `word`, `type`, `partsOfSpeech` (when any), `category`, `meaning`, `situation`, `gap`, `hints`,
  `commonMistake` (when given) and `_aiAdded: true`.
- Refused, with the reason in the drawer: any Arabic letter in the entry ("The generated card contains non-English
  text…"), or the first problem from `V2.validateContent` against the live content ("Cannot add this card: …").
- Otherwise the word is added to the custom words, the game's content is rebuilt (`mergeCustomData`), `dataVersion` is
  bumped (the content save follows), the card switches to "Already in your collection", a toast says
  "<word> added to your collection", and the word is kept in the admin's library (`keepInLibrary`, best effort).

## Pronunciation

`listenTerm` holds the text of the open pronunciation window (`PronunciationModal`); the header's speaker and the
drawer's "Listen" set it, closing clears it.

## Tests

| What | Where |
| --- | --- |
| The AI call can be cancelled; its task name | `tests/ai-operations.test.js` |
| Pronunciation sources and caching | `tests/pronunciation.test.js`, `tests/listening-background.test.jsx` |

**Gaps (before this slice):** nothing tests the drawer's state, the stale-answer rule, adding a word, or the refusals.
