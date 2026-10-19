# Module: live

Live Challenge: one player makes a set of questions, up to nine friends answer them at their own pace, and the server decides who won. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decisions: [ADR 0003](../../adr/0003-grading-location.md), [ADR 0002](../../adr/0002-online-and-local-modes.md).

## 1. Purpose and scope

**Purpose.** A fair, link-based quiz between friends.

**Responsibilities (Implemented)**

- Build multiple-choice questions from the host's words (all, a lesson, or a personal view) and a grammar mix, with variety and freshness rules.
- Create, join, start, begin, answer, end, leave, remove a player, set a rematch.
- Server-side judging and timing; answer keys never reach players before they answer.
- Ranking, results, review of everyone's answers after the end, rematch ("Retry challenge").
- Realtime presence and change events, with polling as a fallback.
- Invitations to friends from a challenge ([social](../social/README.md) provides the friend list and the invitation tables). Live uses social only through its index (the add-friend button on the results); social does not import Live (the app passes it the Live API), so the two are no longer a loop.
- A local backend for tabs of one browser.

**Out of scope**

- Practice and mastery: Live results do not change a player's mastery.
- Friends and requests ([social](../social/README.md)).
- Admin viewing and ending challenges ([admin](../admin/README.md) calls `live_end` and the `admin_live_*` functions).

## 2. Public operations

The Live API in [liveApi.js](../../../src/features/live/liveApi.js).

| Operation | Input | Output |
| --- | --- | --- |
| `create({title, seconds, maxPlayers, startMode, settings, questions, hours})` | questions with prompt, options, answer, word, explanation, sentences | the 6-character code |
| `view(code)` | code | the challenge as this player may see it (questions only after Start, one at a time; the key and everyone's answers only after the end), players, ranks, `now` |
| `join(code)`, `leave(code)` | code | the view / nothing |
| `start(code)` (host, together mode), `begin(code)` (each player) | code | nothing / the view |
| `answer(code, idx, choice, ms)` | question index, chosen text, milliseconds the device measured | `{correct, ms, choice, answer, word, explanation, sentences, me, next, done}`; the same result if retried |
| `end(code)` (host or admin), `removePlayer(code, userId)` (host), `setNext(code, next)` | | nothing |
| `mine()` | none | the player's challenges |
| `openLiveChannel(code, me, {onEvent, onPresence, onStatus})` | | `{send, close}` |

## 3. Files, screens and database objects

- Public surface: [index.js](../../../src/features/live/index.js), used only by the shell: `LiveChallenge` (loaded on demand), `getLiveApi`, `useLivePlayer`, `liveLimits`, `gapRefreshBatch` ([live-setup.md](live-setup.md)).
- Screens: [LiveChallenge](../../../src/features/live/LiveChallenge.jsx) (home, create form, invite page, lobby, ready, race, waiting, results), [LiveFriends](../../../src/features/live/LiveFriends.jsx).
- Logic: [liveEngine.js](../../../src/features/live/liveEngine.js) (question building), [liveRules.js](../../../src/features/live/liveRules.js) (rules shared with the local backend), [liveApi.js](../../../src/features/live/liveApi.js), [transport.js](../../../src/features/live/transport.js), [liveSetup.js](../../../src/features/live/liveSetup.js) and [useLivePlayer.js](../../../src/features/live/useLivePlayer.js) (who plays, the limits, fresh gap sentences).
- Tables: `live_challenges`, `live_answer_keys` (not readable by players), `live_players`, `live_answers`, `live_results`; `live_invites` (owned by social).
- Functions: `live_create`, `live_view`, `live_join`, `live_start`, `live_begin`, `live_answer`, `live_end`, `live_leave`, `live_remove_player`, `live_set_next`, `live_mine`, `live_settle`, `live_finalize`, `is_live_member`, `bump_live_counters` (trigger), `admin_live_matches`, `admin_live_challenges`; invitations: `live_invite_friends`, `live_my_invites`, `live_invite_dismiss`, `live_invites_sent`.
- Realtime: private channel `live:<code>` (members only); local mode uses `BroadcastChannel`.
- Migrations 0008, 0009, 0012, 0020, 0023, 0024.

## 4. Business rules and permissions

- 2 to 10 players; 3 to 50 questions; 2 to 8 options with the answer among them; each question must have a prompt.
- Creation can be limited by the admin: only the admin may create; a cap on players; maximum lifetime (1 to 168 hours, default 24). Non-admins are held to those limits in the database.
- Start modes: **together** (a lobby; the host starts when at least two are in; nobody joins after the start) and **anytime** (open until full or expired).
- A player sees no question before pressing Start, then one at a time; all questions and the key after the challenge is over. Everyone answers in order.
- Time: each answer's time comes from the device but is bounded by the server's own clock since the previous answer, less a slack of 1.5 s plus the feedback card time (0.9 s after a right answer, 1.8 s after a wrong one). With a time limit per question, an overrun counts as no answer.
- A retried answer returns the first result. A late answer after the end is refused.
- Ranking: most right answers, then those who finished, then the shortest total time; equal values share a rank. Players who never pressed Start are not ranked.
- A Live win needs rank 1, more than one player, and not being the host (the host wrote the questions).
- The challenge ends when every started player has finished (together mode; anytime mode also needs it to be full), when it expires, or when the host or admin ends it. Ending early lets those who started keep their results.
- Challenges older than 30 days are removed when their host creates a new one; results stay in `live_results`.
- Row policies let members and the admin read their challenge; answer keys are never readable by players; players cannot write any `live_*` table directly.

## 5. Data flow

1. The host's browser builds questions from the content lists (and pools), and calls `live_create`. The function splits each question into the public part and the private key.
2. Players open `/live/<code>`; `view` returns what they may see; the realtime channel tells them to refresh; polling covers a missing channel.
   - The channel carries only signals ("joined", "left", "start", "progress", "end") and presence (who has the
     challenge open). The players' browsers send them, not the database. A player who gets a signal asks the server
     again (`view`); a "progress" signal updates that player's row directly. Answers, keys and ranks always come from
     the server.
   - Polling: every 20 seconds while the channel works, every 4 seconds when it does not; a finished challenge is
     checked every 8 seconds for a rematch (for half an hour). The Live home checks invitations every 30 seconds; the
     navigation badges every 45 seconds ([social](../social/README.md)). Invitations use no channel.
   - A signal sent before the channel is subscribed (right after opening it, or while it reconnects) waits and goes
     out once it is. After the channel gives up, signals go to the Supabase library, which sends them over HTTP when
     the channel is not joined.
3. Each answer is one `live_answer` call; the response carries the next question.
4. When the last started player finishes (or the time ends) the server settles the challenge, writes `live_results` and a trigger updates the `live_played` and `live_wins` counters on each profile.
5. After the end, `view` returns all questions, the key and all answers for review. "Retry challenge" creates a new challenge and calls `set_next` so others are offered it.

## 6. Failure, retry, cancel, offline

- Offline: the module needs a connection. Messages say so ("You're offline. Live Challenge needs a connection.").
- `answer` is retried up to 3 times with growing waits when the network fails; a server refusal (an error code) is not retried.
- Realtime failure: up to three reconnect attempts (1 s, 3 s, 8 s), then the screen relies on polling. The screen
  does not show whether the channel works (only a console warning "Live channel: …").
- Leaving before pressing Start removes the player (the host leaving an unstarted lobby removes the challenge); after Start a player cannot leave.
- The host can end the challenge or remove a player who has not started.
- A closed tab mid-challenge: the player returns to `/live/<code>` and continues from the next unanswered question; the clock between answers is the server's.

## 7. Tests

| Check | Where |
| --- | --- |
| Rules, local backend, ranking, settling, judging | [tests/live.test.js](../../../tests/live.test.js) |
| Review and rematch | [tests/live-review.test.js](../../../tests/live-review.test.js) |
| The realtime channel with a fake client: signals sent before it is subscribed or while it reconnects go out once it is, retries, status, events and presence, closing | [tests/live-transport.test.js](../../../tests/live-transport.test.js) |
| Question variety and freshness | [tests/live-variety.test.js](../../../tests/live-variety.test.js) |
| Server rules | [supabase/tests/live_challenges.sql](../../../supabase/tests/live_challenges.sql), [live_fairness.sql](../../../supabase/tests/live_fairness.sql), [live_review.sql](../../../supabase/tests/live_review.sql) |
| Two players in two tabs, with friends and invitations | [e2e/specs/friendslive.cjs](../../../e2e/specs/friendslive.cjs), [e2e/specs/livelib.cjs](../../../e2e/specs/livelib.cjs) |

**Gaps.** No test compares the local backend with the SQL functions (the library has such a test; Live does not; `MT-05`). The realtime channel and its fallback are untested against a real Realtime service. The host's question content is not validated against the course (see Known Issues).

## 8. Example journey

Dana (synthetic) challenges two friends.

1. Dana opens Live, chooses "Words from my view Travel", 10 questions, 20 seconds each, together mode, 3 players, and sends invitations to two friends.
2. `live_create` returns `K7M2QX`. The lobby shows a link and the friends' status. Friends open the invitation, press Join; Dana presses Start.
3. Each player presses their own Start; the first question appears. Each answer returns right or wrong, the key, and the next question. One friend loses the connection after question 4 and comes back; the screen continues at question 5.
4. When all three have finished, the server ranks them. Dana's result is marked as host and does not count towards Live wins. Everyone sees all answers and can press "Retry challenge" to offer a rematch.

## 9. Status

**Implemented.** Everything above.

**Fixed**

- 2026-10-19: the "joined" signal a player sends on opening the channel was always lost (it was sent before the
  channel existed), so the host saw a new player only through presence or the next poll. Signals now wait for the
  channel (`tests/live-transport.test.js` failed before the fix).

**Planned**

- Realtime from the database (proposed, not built): the database sends the signals (a trigger on joins, start,
  answers and end), so a signal cannot be lost with a player's browser; and a personal channel per player for
  invitations and friend requests, so they arrive in about a second instead of up to 30–45 seconds. Polling would
  stay as a slower safety net. Needs a migration and a check of the Supabase plan's Realtime limits.

**Known Issues**

- `MT-05` the local backend is a second copy of the server rules with no differential test.
- Signals come from the players' browsers: one that is lost (a browser closes or drops at that moment) is not sent
  again, and the others see the change at their next poll (up to 20 seconds). Invitations wait for the 30-second
  check (Live home) or the 45-second badge check.
- Assumption (not tested): the server checks the shape of the host's questions and that the answer is among the options, but not that it is the correct answer to the prompt; a careless or malicious host can create wrong keys. This affects only that match.
