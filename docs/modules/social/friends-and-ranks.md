# Friends, ranks and the profile's Live history (social)

What a player sees and can do on the Friends page, the leaderboard (Ranks) and the profile's "Recent live matches",
and how the navigation badges are counted. Part of the [social](README.md) module. The server's rules (limits,
waiting weeks, who may read what) are in the README and in `supabase/tests/friends.sql` and `ranks.sql`.

Status: **Implemented** (current code). Written down from the code before slice 1 of Social & Live moved it; the
move kept it (see Tests).

## Files and interface

Other modules use only [index.js](../../../src/features/social/index.js) (the shell and Live):

| Export | For | What |
| --- | --- | --- |
| `useSocial({ player, enabled, liveFor })` | the shell | `{ friendsApi, counts, refresh, badges }`: the friends API for the player, the waiting counts and the navigation badges. `liveFor(me)` gives the Live API; it is called only in local mode (local invitations look at the challenge), so social does not import Live. |
| `ranksShown(app, isAdmin)`, `ranksHiddenFromPlayers(app, isAdmin)` | the shell | the Ranks tab and `/leaderboard`; the admin's note |
| `AddFriendButton`, `useFriendStatus` | Live's results | the add-friend button and the friends list behind it |
| `onSocialSignal` | Live's invitations list | listens to the database's signals to this player |
| `LOCAL_PEOPLE` | the shell, for the library | who is friends with whom in local mode, read from this browser |
| `FriendsPage`, `Leaderboard`, `ProfilePage` | the shell | the screens, each loaded on demand |

Inside the module:

- [socialRules.js](../../../src/features/social/socialRules.js), no state: `RANK_TABS`, `FIRST_RANK_TAB`,
  `thisWeekPoints`, `emptyRanksText`, `friendsBoardOrder`, `friendStatusOf`, `NO_COUNTS`, `nextCounts`, `navBadges`,
  `socialStorageKey`, `requestDoneText`, `historyPlace`, `historyScore`, and the two Ranks rules above.
- Hooks: [useSocial.js](../../../src/features/social/useSocial.js), [useSocialCounts.js](../../../src/features/social/useSocialCounts.js)
  (`useSocialCounts(api, enabled)`, `useRefreshOnActivity`), [useLeaderboard.js](../../../src/features/social/useLeaderboard.js)
  (`useLeaderboard(tab, me, friendsApi)` returns `{ rows, error }`), [useFriendsList.js](../../../src/features/social/useFriendsList.js)
  (the Friends page's list, busy state, message and actions), [useLiveHistory.js](../../../src/features/social/useLiveHistory.js).
- Data: [friendsApi.js](../../../src/features/social/friendsApi.js) (`getFriendsApi(me, liveFor)`: the database
  functions online, `localStorage` in local mode; `createLocalFriendsApi`; used only inside the file: `FriendsError`,
  `MAX_INVITES` and the local helpers), [socialApi.js](../../../src/features/social/socialApi.js) (`fetchLeaderboard`, `fetchFriendsBoard`,
  `fetchLiveHistory`).
- Screens: [FriendsPage](../../../src/features/social/FriendsPage.jsx), [Leaderboard](../../../src/features/social/Leaderboard.jsx),
  [ProfilePage](../../../src/features/social/ProfilePage.jsx), [AddFriendButton](../../../src/features/social/AddFriendButton.jsx).
- Times like "42.5s" come from `formatMs` in [lib/format.js](../../../src/lib/format.js) (Live uses it too; `liveRules`
  still offers it).

## The navigation badges

- `useSocialCounts` asks `counts()` (online: `social_counts`) when the game has loaded, every 45 seconds, when the tab
  comes back into view or gets focus, and in local mode when another tab changes friends or Live data (`storage`
  keys starting `friends1:` or `live3:`). A failed check keeps the last numbers; before the game has loaded both are 0.
- Online, the player's own private channel `user:<id>` ([socialSignals.js](../../../src/features/social/socialSignals.js),
  opened by `useSocial` once the game has loaded) brings the database's signals (migration 0043): "friends" when a
  request is sent, answered or ended (to both players) and "invite" when the player is invited to a challenge. On a
  signal the badges are counted again at once, the Friends page reads its lists again, and the Live home reads its
  invitations again. A lost channel is kept and realtime-js joins it again by itself for as long as the game is open
  (like Live's channel); the checks above carry on meanwhile. Before 2026-10-22 it was tried again after 1, 3 and 8
  seconds and then given up, so after a longer loss no signal arrived until the game was opened again
  ([Live](../live/README.md), Fixed).
  Nobody but the database can send on these channels, and a player can read only their own.
- The Live tab shows the waiting invitations, the Profile tab the waiting friend requests; above 9 the badge says
  "9+". The Profile page's Friends button shows the requests too.

## Ranks (the leaderboard)

- Shown to players only while ranks are on (Admin -> Settings, `leaderboard`, on by default). With ranks off a player
  has no Ranks tab and `/leaderboard` goes home; the admin still sees the page with the note "Ranks are hidden from
  players (Admin → Settings → Ranks). Only you can see this page."
- Four tabs, "This week" first: **Friends**, **This week**, **All time**, **Live wins**. Each has its note under the
  tabs (practice points are counted by each player's game; Live wins are checked by the server; a challenge's
  creator does not get a win).
- What each tab reads (up to 50 rows from `profiles`):

| Tab | Rows | Order | Value |
| --- | --- | --- | --- |
| This week | `week_start` is this week's Monday and `week_score` > 0 | `week_score`, highest first | `week_score` pts |
| All time | everyone the server lets the player read | `score`, highest first | `score` pts |
| Live wins | `live_played` > 0 | `live_wins` highest first, then fewer `live_played` | `live_wins` wins, "N played" |
| Friends | the player and their friends (the friends list first, then their rows) | this week's points, then `score` | this week's points (0 when `week_start` is another week), "N all time" |

- "This week's Monday" is worked out by the **browser**, in the player's local time (`weekStart`).
- Each row: the position (1, 2, 3 get their own style; equal values do not share a place), the username, "(you)"
  for the player, an add-friend button (not on the player, not on the Friends tab), "N mastered · Nd streak", and
  the value.
- While a tab loads: five empty rows. A failed read shows its message. An answer for a tab that is no longer chosen
  is dropped.
- Empty: This week "No points yet this week — play a round to take first place.", All time "Nobody has scored yet.",
  Live wins "No live matches yet."; Friends with only the player: "Add friends to compare your week with theirs." and
  a "Find friends" button.
- Local mode: "The leaderboard needs the online version." and no rows (no read is made).

## The add-friend button

Shown after a name on the leaderboard and on Live's results. It needs the friends list (one read per screen); until
it has it, or in local mode on the leaderboard, there is no button.

| The other player is | The button | A tap |
| --- | --- | --- |
| a friend | "✓ Friends" (not a button) | |
| asked by me | "Requested", disabled | |
| asking me | "Accept" | accepts (`respond(id, true)`) |
| anyone else | "Add" | sends a request by username |

While it runs it says "…"; after it the list is read again. On a refusal it says "Try again", with the message as its
tooltip.

## The Friends page

- A form: username (up to 30 characters, no auto-capitalise) and "Send request" ("Sending…" while it runs; disabled
  while the field is empty). Done: "Request sent to <name>. They'll see it next time they open the game." or, when
  they had already asked, "You and <name> are friends now." The field is cleared. Typing clears the message.
- Lists: "Requests for you (N)" with Accept ("You and <name> are friends now.") and Decline (no message); "Your
  friends (N)" with Challenge (opens `/live?invite=<id>`) and Remove, which asks "Sure?" on a second tap ("<name> is
  no longer your friend."); "Waiting for an answer (N)" with Cancel ("Request taken back.").
- Online, a friend's row says "N pts · Nd streak · N live wins". Local mode adds "(Local mode: you can find players
  who opened the game in this browser.)" to the help text.
- While an action on a list runs, the list buttons are disabled ("Send request" only while it sends). After a change
  the list is read again and the badges are counted again. The list is also read again on the same events as the badges (every 45 seconds, focus, view, storage).
- A failed action shows the server's message as it is (limits, waiting weeks, "No player is called …"). No
  connection: "You're offline. Friends need a connection." A failed read shows its message above the lists (which stay as they were).

## Recent live matches (Profile page)

- Online only: the player's last 10 rows of `live_results`, newest first. Local mode, or a failed read: "No live
  matches yet. Create a challenge from the Live tab and send the link to your friends."
- Each row: "🏆 " when the player was first of more than one player, otherwise "#<rank> "; the title; the date and
  "N players"; "<correct>/<total> right"; the total time (`formatMs`, for example "42.5s" or "1:05") or, without a
  time, "N pts"; " · unfinished" when the player did not finish. A tap opens `/live/<code>`.

## Tests

| What | Where |
| --- | --- |
| Everything above in a browser with the app built for online mode and a fake Supabase: the badges, the four tabs (what each reads, order, values, notes, empty and failed reads), the add-friend button, the Friends page's actions and messages (offline too), the Live history, Ranks off for players and the admin, local mode's text | `e2e/specs/social.cjs` |
| The rules | `tests/social-rules.test.js` |
| The player's channel and its listeners (private `user:<id>`, both signals, a lost channel kept and heard again once joined, closing, nothing in local mode; the badges and Live's invitations ask again) | `tests/social-signals.test.jsx` |
| What the database sends and who may read it | `supabase/tests/realtime_signals.sql` |
| The hooks: the friends API and badges (online, local, before loading), a tab's rows (a late answer dropped, the Friends tab), the Friends page's actions, the Live history | `tests/social-hooks.test.jsx` |
| Social in no loop, not importing Live, reached only through its index (by the shell and Live) | `tests/architecture.test.js` |
| Local friends rules and messages | `tests/friends.test.js` |
| Two tabs in local mode: ask, accept, invite, join | `e2e/specs/friendslive.cjs` |
| Profile page with the catalog link | `tests/profile-catalog.test.jsx` |
| The server's rules | `supabase/tests/friends.sql`, `supabase/tests/ranks.sql` |

How the behaviour was kept: `social.cjs` passes on the code before the move and after it. The rules were moved
unchanged and compared with the old inline code on random made-up inputs (88,260 checks: tabs, the friends board,
statuses, counts, texts, who sees Ranks; one-off, not kept). Deliberate breaks (20) each make a unit test fail.

## Known Issues

- `PE-01`: the practice numbers on Ranks are as honest as the game that sent them.
- The week boundary uses each player's local clock.
- Positions on Ranks are row numbers: two players with the same value get different places.
- Found by `social.cjs`: accepting a request with the add-friend button (Ranks, Live's results) does not count the
  badges again itself. Online with migration 0043 the database's "friends" signal now counts them again within about a
  second; in local mode, or without 0043, they catch up at the next check (45 seconds, focus or view). The spec's
  fake Supabase has no Realtime, so it still sees the wait.
- `getFriendsApi` keeps the first API it makes for the rest of the page's life (its `me` is the first player). Online
  it does not use `me` (the server knows the account); in local mode the player is the tab's player, which does not
  change.
