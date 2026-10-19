# The challenge room (live)

What a player's screen does inside one challenge (`/live/<code>`): loading it, keeping it up to date, the actions,
and which screen shows. Part of the [live](README.md) module; the server's rules (players, timing, ranking) are in
the README, the channel's signals in its data flow.

Status: **Implemented** (current code). Written down from `ChallengeRoom` in
[LiveChallenge.jsx](../../../src/features/live/LiveChallenge.jsx) before slice 3 of Social & Live moved its logic into
a hook; the move keeps it (see Tests).

## Loading

- The room asks the server for the challenge as this player may see it (`view`). Until it arrives: three empty rows.
- If the first read fails: "Challenge not available", the server's message, and "Back to Live Challenge". A later
  failed read keeps the screen as it was.

## Keeping it up to date

- **Questions are never taken back.** They arrive one at a time (with Start, then with each answer). A newer read of
  the same challenge that has fewer questions than the screen keeps the ones already shown (an older, slower answer
  must not hide the current question). After the end the server's full list is used.
- **The next question** that comes with an answer is put in its place at once, unless the screen already has one
  there.
- **My own numbers** (answered, right, time, finished) come from my last answer until the server's row has caught up:
  the screen uses my row from the answer while it has answered more than the server's row.
- **The channel** (only once the player has joined): signals from others make the room read the challenge again,
  except "progress", which updates that player's row in place (only if it is not older than what the screen has) and
  reads again only when that player has finished. Presence (who has the room open) is shown as a dot; someone present
  who is not in the list makes the room read again. On opening the channel the player sends "joined".
- **Polling**, while the challenge is not over: every 20 seconds while the channel works, every 4 seconds while it
  does not (connecting, or given up).
- **A rematch**: a finished challenge that this player is in, with no rematch yet, is read every 8 seconds for half an
  hour after it ended, so "Join the new challenge" appears.
- Pictures of the questions are loaded ahead as they arrive.

## Actions

Each action disables the buttons while it runs ("busy"), shows the server's message if it fails, and puts the
challenge it returns (if any) on screen.

| Action | Who | Then |
| --- | --- | --- |
| Join (`join`) | someone invited | sends "joined" |
| Start (`start`) | the host, in the lobby, with 2 or more players | sends "start", reads again |
| Leave (`leave`) | a player who has not started (the host: "Cancel challenge") | sends "left", goes to the Live home |
| Remove (`removePlayer`) | the host, a player who has not started | sends "left" for them, reads again |
| Begin (`begin`) | each player (together: after a 3-2-1 countdown; anytime: the Start button) | |
| End (`end`) | the host, while waiting for others | sends "end", reads again |
| Open a rematch | anyone on the results | joins it first unless they made it (a failure is explained on its page), then opens it |

After each answer the room keeps the player's new row, sends "progress" with it, and reads again when the player has
finished; the last answer of the challenge also sends "end". A failed answer (after its retries) reads again.

## Which screen

1. Not a member: the invitation (the title, who invited, the rules, the players; "Join the challenge", or why one
   cannot join: ended, started, full).
2. The lobby (state `lobby`): the link, the players with "here now" dots, invitations to friends, Start or Leave.
3. The results (state `done`).
4. Ready (not yet started): the countdown, or Start.
5. Playing (not finished): one question, the timer, the race (it can be hidden; remembered on this device).
6. Waiting (finished, others still playing): my score, the race, and for the host "End the challenge now".

## Tests

| What | Where |
| --- | --- |
| A whole room in two tabs (local mode): the link, the host seeing the guest arrive, starting together, questions in order, the race, a reload in the middle, waiting, results, a rematch, removing, leaving, cancelling | `e2e/specs/liveroom.cjs` |
| The channel itself (signals, retries, status) | `tests/live-transport.test.js` |
| Invitations from friends, joining from them | `e2e/specs/friendslive.cjs` |
| The server's rules | `tests/live.test.js`, `supabase/tests/live_*.sql` |

## Known Issues

- The guard against a slower read hiding questions compares only the number of questions; it does not check which
  read is newer.
