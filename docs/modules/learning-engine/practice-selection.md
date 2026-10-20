# Practice question selection (learning-engine)

How `V2.practice` builds a practice session today. Part of the [learning-engine](README.md) module; the screens and session lifecycle that call it are in [practice](../practice/README.md). Work record: [practice-baseline.md](../../work-tracking/practice-baseline.md).

Status: **Implemented** (current code, described from `src/engine/v2.js`). Moved here from `docs/architecture/modules.md`; the content is unchanged except for headings and links.

This slice builds an offline Practice session: eligible words, question forms,
safe options, question order, grammar slots, and unused questions for later
reinforcement. The current entry point is `V2.practice`, not a new feature module.
Characterization finished at `7104306`; the private selection extraction starts
from the documented baseline `2da4133`.

## Files and responsibilities

| File | Role in this path |
| --- | --- |
| `src/app/WordHunter.jsx` | `startPractice` gathers inputs and adjusts new-word intake from the previous round. `buildPracticeExtra` supplies extra styles; `launchSession` sends the result to the UI. |
| `src/engine/v2.js` | `practice` builds candidates, filters stale sentences, inserts grammar and returns the session. Private `selectPracticeQuestions` orders word candidates. `makeQuestion` builds basic word questions, `optionWords` chooses distractors, grammar builders produce rule questions. `reinforcement` consumes reserves later. |
| `src/engine/questions.js` | Extra-style factories such as Who Am I, Opposites and paired questions; `legacyQuestionToV2` adapts their output to the session contract. `buildRound`/`buildAdaptiveRound` are not called by the current Practice start path. |
| `src/engine/data.js` | Level groups, mastery helpers and mode metadata used by the shell and older factories (the content itself is passed in; see [content-catalog.md](../content/content-catalog.md)). |
| `src/engine/text.js` | Text normalization used by extra-question safety checks; no imports. |
| `src/features/session/SessionView.jsx` | Shows introductions, then `session.queue[session.index]`; `AnswerControl` renders the answer type. Offers reinforcement through the existing engine interface. |

## Interface used by callers

Import `{ V2 }` from `src/engine/v2.js` and call:

```js
V2.practice(content, mastery = {}, category = null,
  rng = Math.random, quarantine = null, opts = {})
```

| Input | Meaning |
| --- | --- |
| `content` | Already loaded runtime content: required `words` array; optional `grammar`, `combos`, `challenges`. Not a raw import file. |
| `mastery` | Current learning records keyed by exact word text or prefixed activity key, e.g. `grammar:<id>`. Read for selection; not persisted here. |
| `category` | Optional lesson filter, compared using existing topic normalization. |
| `rng` | Function returning a draw in `[0, 1)`; used for shuffles, ties and session ID. |
| `quarantine` | Optional Set of `lowercase-trimmed-word|mode` keys excluded from candidate generation. |
| `opts` scope | `scope: { words: Set, rules: Set }`, `unit`, `subCategory`, `noGroup`, `courseLevel`, `noCourseLevel` narrow the requested content. Distractors still use the full `content.words`. |
| `opts` session/context | `questionsPerRound`, `newWordsPerRound`, `title`; `pools` (existing variants), `seen` (normalized sentences to timestamps), `confusions` (word-pair records). |
| `opts.extraQuestion` | Optional `(word, stage, rng) => question \| null` callback. Called for eligible known words outside the production gate. Uses the same question contract as the built-in factories. |

The synchronous result is a session containing `kind: 'practice'`, `id`,
`title`, `queue`, `introductions`, `index: 0`, `answers: []`, `initialLength`,
`targetLength`, `reserves`, and `extraAdded: false`. The requested length is a
target, not a guarantee; an empty or short queue is valid current output.
Questions carry `id`, `mode`, `type`, `prompt`, `answers`, and `targets`;
choice questions also carry `options`. Optional metadata includes `difficulty`,
`explanation`, `hints`, pool identifiers, grammar `progressKey`, and
`initialTraining` for the opening fallback. Preserve these shapes and keys.

Example using already loaded content and state (no fetch or generation call):

```js
const session = V2.practice(content, mastery, null, rng, quarantine, {
  questionsPerRound: 12,
  newWordsPerRound: 3,
  scope: { words: new Set(["Word0", "Word1"]), rules: new Set() },
  pools, seen, extraQuestion: buildPracticeExtra,
});
const firstQuestion = session.queue[0]; // May be undefined; introductions are separate.
```

`V2.reinforcement(session)` later returns a session with at most two extra
questions for missed targets and `extraAdded: true`; it returns the supplied
session unchanged if already processed or not Practice. It uses reserves in
order and checks recent targets and shown sentences. Reserves are candidates,
not a promise that every item can be appended.

## Request flow and state

1. Home's level/course/items/view handler resolves the scope and calls `startPractice`.
2. The shell reads settings, previous-round results, mastery/pool/confusion refs
   and seen sentences, then calls `V2.practice` with `buildPracticeExtra`.
3. The engine filters content, picks new/known words, chooses modes and builds
   candidates. Extra styles go through the callback and, where needed, the
   factories/adaptor in `questions.js`. Grammar candidates are built separately.
4. `practice` removes stale candidates, then calls `selectPracticeQuestions`.
   The helper excludes repeated sentences/recent targets, prioritizes unused
   targets and balances modes. It leaves unselected candidates in `reserves`.
   Back in `practice`, grammar is inserted and the complete session is returned.
5. `launchSession` sets `activeSession` and the session screen. `SessionView`
   advances its index through that prebuilt queue; it does not generate a fresh
   question on each Continue.

The engine does no network/storage I/O. Its queue, usage counters and sets are
local to the call, but candidate arrays are spliced and an opening candidate
can receive `initialTraining`. Do not assume deep cloning of callback questions
or content objects. `v2.js` also has a shared normalization cache and reads
`Date.now()` for freshness, locks and IDs. Tests must fix both time and RNG.

The private boundary is `selectPracticeQuestions(candidates, wordSlots, lastIntro)`:

- `candidates`: the ordered, already-built word/activity questions remaining
  after freshness filtering. The helper removes selected items **in place**;
  the same array becomes session `reserves`, preserving the remaining order.
- `wordSlots`: requested length minus the grammar candidates already built.
- `lastIntro`: the last introduced word text, or `undefined`. It is avoided as
  the first target unless the existing opening fallback is needed.
- Returns a new ordered `queue` array containing the original question objects.
  The fallback can set `initialTraining` on its selected question.

Mode counts/weights, used targets/sentences and per-word usage live only in this
helper call. It uses the existing `questionSentences` helper and has no RNG,
clock or callback calls. Candidate generation, `extraQuestion` calls, stale
filtering, grammar insertion and session-ID creation stay in `practice` in
their existing order. Selection still stops if nothing is eligible; it does
not relax repetition constraints or fill unused slots with invented questions.

The shell owns learner state in React state/refs; older factories read mutable
`data.js` exports and some use ambient `Math.random`. `buildPracticeExtra`
also reads pool/seen refs and image eligibility. Thus the whole UI path is not
made deterministic just by passing an RNG to `V2.practice`. Entry-based sessions such as
the Speed Round's questions are built with `poolsSnapshotForSession` in `questions.js`, which is always an empty
object: nothing has set it since Weak Evidence and Final Recall were removed on 2026-10-20, and its setter was
removed with the unused exports. So those questions are built without the generated pools.

After building the session, the shell may request fresh text in the background
and update a toast. Saving, AI requests, media checks, Library scope retrieval,
and answer side effects remain outside this slice and behind existing interfaces.

## Where to start a future change

| Intended change | Starting point |
| --- | --- |
| Basic word question wording/shape or distractors | `makeQuestion` / `optionWords` in `v2.js` |
| Extra question style | `buildPracticeExtra` in the shell, then its factory in `questions.js` or `v2.js`; preserve the adapted question shape |
| Candidate word/mode eligibility or freshness | Generation and stale-filter blocks in `practice` in `v2.js` |
| Word-question ordering, repetition, opening fallback or short-round behavior | Private `selectPracticeQuestions` in `v2.js` |
| Grammar question form / selection | `grammarQuestion` / the grammar selection block in `practice` |
| Follow-up questions after mistakes | `reinforcement` and the reserves contract |

Changing a learning rule is a separate behavior change, not part of this
extraction. Scoring, mastery, persistence and UI wiring are unchanged. The known
single-style short-round observation is tracked as **PRACTICE-OBS-01** in the
[work record](../../work-tracking/practice-baseline.md#observed-edge-requiring-separate-review);
it has not been classified as a confirmed bug or accepted as intended pedagogy.

## Tests

From the repository root, with dependencies installed from the lockfile:

```sh
npm test -- tests/practice-selection.test.js
```

This is the focused nine-case selection baseline, using synthetic content,
seeded RNG and a frozen Date. The [work record](../../work-tracking/practice-baseline.md#execution-record)
lists the broader relevant command and actual before/after results. It includes
scope/options, single-new-word, grammar, senses, course levels and grading tests.
No new UI/E2E coverage was needed because no UI wiring changed; the full engine,
real shell callback and production behavior are not exhaustively covered here.
