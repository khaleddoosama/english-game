# Live Challenge

A link-based multiplayer quiz: the creator picks the words and the rules,
gets a link `/live/<CODE>`, and 2–10 players answer **the same questions at
their own pace**. Most right answers wins; a tie goes to whoever finished,
then to the lowest total time. **No AI is used.**

Files: `src/features/live/` — `LiveChallenge.jsx` (screens), `liveEngine.js` (question building), `liveRules.js` (rules, shared with SQL), `liveApi.js` (server calls), `transport.js` (realtime), `LiveFriends.jsx` (invites). Database: migrations 0008, 0020, 0023, 0024; tests `supabase/tests/live_*.sql`, `tests/live*.test.js`.

## 1. Life of a challenge

```
lobby ──(host: live_start, ≥2 players)──▶ playing ──(everyone finished / expired / host ends)──▶ done
   └ start_mode "anytime": created directly as "playing"
```

| Step | Client | Server RPC | What the database does |
|---|---|---|---|
| Create | `CreateForm.create` → `liveQuestions()` builds questions locally | `live_create(title, seconds, max_players, start_mode, settings, questions, hours)` | validates (3–50 questions, 2–8 options each, answer inside options, ≤ 400 000 chars), splits **public** questions and **secret** key, makes a 6-char code (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, no 0/O/1/I/L), adds the host as a player, deletes the host's own challenges older than 30 days |
| Join | open link → `Invite` screen | `live_join` | refuses if done, if "together" has started, or if full |
| Start (together) | host presses Start | `live_start` | needs ≥ 2 players; `playing`; `expires_at = min(expires_at, now + 3 h)` |
| Ready | each player: 3‑2‑1 countdown (together) or a Start button (anytime) | `live_begin` | sets that player's `started_at` and `last_at` (their personal clock) |
| Answer | `Play.submit` | `live_answer(code, idx, choice, ms)` | row-locks the challenge, then the player; judges against the key; returns result **and the next question** |
| Finish | last answer | inside `live_answer` → `live_settle` | when all players finished (and for "anytime" the challenge is full) → `live_finalize` |
| End | host "End now" / time over | `live_end` / lazily in `live_settle` | `live_finalize` writes `live_results` with rank; trigger updates `live_played` / `live_wins` |
| Rematch | "Retry challenge" | `live_set_next` | leaves the new code on the old challenge; first one wins; only members see it |

`live_settle` runs **lazily**: it is called at the start of `live_view`, `live_join`, `live_begin`, `live_leave`, and inside `live_answer` when a player finishes or time is over. Nothing runs by itself on a timer.

## 2. Questions: how they are built (`liveQuestions`)

Only multiple choice (a typo should not lose a match). Types (`LIVE_KINDS`): meaning, reverse ("word from meaning"), gap, whoami, opposite, antonym ("opposite clue"), picture, collocation ("word partners"), family, grammar. The creator can switch types on/off.

1. Candidates: a freshest-first sample of `max(count*2, 24)` words plus all grammar rules of the chosen lessons.
2. For each candidate every allowed type is built (`V2.makeQuestion` at difficulty 2 → 4 options, or the builders in [question-options.md](question-options.md)); a question is `usable` only if `mcq`, has a prompt, ≥ 3 options and an answer, and its prompt does not contain the answer.
3. **Variety + freshness score**, picked one at a time, lowest wins:
   `score = tier*4 + exact*2 + usedSoFar[type] + random(0–0.5)`
   - `tier` 0 = this word/sentence was never read on this device, 1 = read more than 20 h ago, 2 = read in the last 20 h (memory: `seenSentences`, keys `live <kind> <word>` and the sentences);
   - `exact` is the same for the exact question (not the word);
   - `usedSoFar[type]` spreads the types.
   One question per word or rule — then that word is removed from the candidates.
4. Each question carries everything (`mode, prompt, options, answer, word, explanation, picture/photo, sentences`) because the other players don't have the host's words. `splitQuestions` removes `answer/word/explanation/sentences` from the public part.
5. After every answer the client calls `onSeen` with the sentences so the host's next practice/Live avoids them.

Because the host *writes* the questions, the host knows the answers: their result is marked `is_host` and **never counts as a Live win**.

## 3. Fairness rules (server-side, migration 0020)

- No question is visible before the player presses Start. Then **one at a time**: `live_view` returns questions `n <= answered + 1`; `live_answer` returns `next`. All questions + the key are visible only when the challenge is `done`.
- Answers must be in order (`idx = answered`) and need `started_at`.
- **Time:** the device measures `p_ms`. The server measures `elapsed` since the player's `last_at` (`clock_timestamp()`), then
  `ms = least(greatest(p_ms, 0, elapsed − slack), elapsed)`
  where `slack = 1500 ms + the feedback card of the previous answer (900 ms if correct or reveal is off, else 1800 ms)`. So the device may report *less* than the server saw, but only by the card and network time.
- Over the time limit → `ms = limit`, answer not correct.
- A re-sent answer returns the first result (safe to retry; the client retries up to 3 times: `withRetry`).
- Answers and "End now" take turns on the challenge row (`for update`), so a last answer and an end cannot cross.
- Everyone's answers become visible to members only after the end (0023).

Ranking: `rank() over (order by correct desc, finished desc, total_ms asc)`; equal values share a rank.

## 4. Real-time today

### Transport (`transport.js`)
- Online: Supabase Realtime **Broadcast + Presence** on the private channel `live:<CODE>` (`broadcast.self = false`, presence key = user id). Local mode: `BroadcastChannel('live3:<CODE>')` with a 1 s heartbeat.
- Events: `joined`, `left`, `start`, `progress`, `end`.
- Connect failure: retries after 1 s, 3 s, 8 s, then status `offline`.
- **The game never depends on it.** All state changes are RPCs; the channel only says "something changed, look again".

### What the room does with it (`ChallengeRoom`)
| Signal | Reaction |
|---|---|
| `progress` event `{user_id, answered, correct, total_ms, finished_at, started_at}` | patches that player's row in `view.players` **without a request** (ignored if `answered` is older); if `finished_at` → `refresh()` |
| any other event (`joined`, `left`, `start`, `end`) | `refresh()` = RPC `live_view` |
| presence sync with an unknown id | `refresh()` |
| fallback timer | `refresh()` every **20 s** when the channel is live, every **4 s** otherwise; after `done`, every 8 s for 30 min to catch a rematch |

### Timeline of one answer (what opponents see)

```
t0   player taps option
t0+  RPC live_answer starts                      (≈ one round trip, row locks)
t1   RPC returns → feedback card shown (900 ms correct / 1800 ms wrong)
t1+card  onProgress() → setLocalMe + send("progress")    ◀── opponents learn here
t2   opponents' bars move (no request)
```
So an opponent sees your progress **0.9–1.8 s after the server knew it**.

## 5. How to make it more real-time (ordered by value / effort)

### Quick wins (hours)

1. **Send `progress` as soon as the RPC returns.** In `Play.submit` (`LiveChallenge.jsx`) the broadcast is inside the `setTimeout` that waits for the feedback card. Send it right after `api.answer` resolves (the payload only holds counts that the opponents will see anyway). Saves 0.9–1.8 s per answer.
2. **Refresh on return to foreground.** `ChallengeRoom` has no `visibilitychange` / `online` handler (Friends has one). A phone that slept shows old standings until the next 20 s poll, and a dropped socket is not rebuilt after the 3 retries. Add: on `visibilitychange → visible` and on `online`: `refresh()` and, if the channel status is `offline`, reopen it.
3. **Keep trying to reconnect.** After the last retry in `realtimeChannel`, schedule another attempt every 30 s instead of staying `offline` until a page reload.
4. **Debounce `refresh()`.** With 10 players, bursts of `end`/`progress(finished)`/presence events each cause a `live_view` call. Coalesce them (e.g. one call per 300 ms).
5. **Animate the race bars** (CSS transition on width) so a small update feels live.

### Medium (a day)

6. **Move the progress broadcast into the database** (also fixes a trust problem).
   Today any member can send `progress` for **any** `user_id`: `onEvent` trusts `payload.user_id` and only the display changes, but a cheater (or a bug) can show fake scores to everyone until the next `live_view`. Supabase supports *Broadcast from the Database*: `realtime.send(payload jsonb, event text, topic text, is_private boolean)`. At the end of `live_answer`, `live_begin`, `live_join`, `live_leave`, `live_start`, `live_finalize` call
   `perform realtime.send(jsonb_build_object('user_id', v_me, 'answered', p.answered, 'correct', p.correct, 'total_ms', p.total_ms, 'finished_at', p.finished_at, 'started_at', p.started_at), 'progress', 'live:' || v_code, true);`
   Then remove the client `send` and make the members' **insert** policy on `realtime.messages` stricter (or remove it) so clients cannot post `progress`. Keep presence on the client. Test with a new SQL test (`supabase/tests/`) and a Vitest case in `tests/live.test.js`.
   The alternative, *Postgres Changes* on `live_players` filtered by `code`, is simpler to write but scales worse (RLS is evaluated for every subscriber).
7. **A shared "Go!" for Together mode.** Each player starts their own clock after `live_start` + local 3‑2‑1 + `live_begin`, so players leave the line at slightly different times (fine for fairness, bad for the race feeling). In `live_start` store `go_at = now() + 4 s`; the client compares with `view.now` (server clock) to count down to the same instant; `live_begin` refuses before `go_at`.
8. **Settle by itself.** Because `live_settle` is lazy, a challenge nobody opens after the deadline stays `playing` and its results/`live_wins` are not written until someone opens it. Add a `pg_cron` job (every minute) that calls `live_settle` for `state <> 'done' and expires_at < now()`, and send a `end` broadcast from `live_finalize` (see 6).
9. **Real-time invitations and friend requests.** They are polled (on open, every 45 s, on tab return). Give each user a private channel `user:<id>` and `realtime.send` from `live_invite_friends` and `friend_request` (policies: a user may select only `user:<their id>`). Show a toast.
10. **Presence details.** Show "answering Q7" or "reconnecting…" from presence metadata (`track({id, name, idx})`), and mark a player who has been absent > 30 s.

### Large (design first)

11. **Synchronous "Duel / Kahoot" mode** (`start_mode = 'sync'`): everybody sees question *n* at the same moment. Needs `current_idx` and `question_started_at` on the challenge, an RPC `live_advance` that moves on when all answered or the timer ended (checked on the server; any client may call it, the first call wins), a broadcast `question` event from the database, and points for speed. Scoring and the `ms` clamp change (the clock starts at `question_started_at`). Keep the current own-pace mode — it works across time zones.
12. **Spectators / reconnect after a crash.** Let a member re-enter mid-run (already supported: `live_view` returns questions up to `answered + 1`) and show a "resume" prompt from `live_mine`.

### How to measure

Log (dev only) for each answer: RPC duration, time until the broadcast was sent, time until a second browser painted it. Target: opponents' bars move < 300 ms after the server accepted the answer. Test with two browsers and `Network → Slow 3G`.

## 6. Risks and limits to remember

- `refresh()` → `live_view` builds the whole player list each time; fine for 10 players, do not call it per keystroke.
- Realtime message limits are per project plan (messages/s per channel, concurrent connections). 10 players × 1 progress per ~8 s is far below any plan.
- The `progress` event is advisory; the final truth is always `live_results`. Never compute a winner on the client.
- Local mode (`createLocalLiveApi`) re-implements the SQL rules in JS using `liveRules.js`. When you change a rule in SQL, change it in `liveRules.js`/`liveApi.js` too and keep `tests/live.test.js` green.
