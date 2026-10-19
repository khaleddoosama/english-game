# Who plays, what they may create, and fresh sentences (live)

What the app decides before and around a Live challenge: who the player is, the limits and defaults of a new
challenge, and the background request for new gap sentences after a challenge is made. Part of the
[live](README.md) module; the challenge itself (questions, joining, answers, ranks) is in the README.

Status: **Implemented** (current code). Written down from the code before slice 2 of Social & Live moved it out of
the shell ([WordHunter.jsx](../../../src/app/WordHunter.jsx)); the move kept it (see Tests).

## Files and interface

- [liveSetup.js](../../../src/features/live/liveSetup.js), no state: `tabPlayer(storage, random)`,
  `playerOf(profile, tab)`, `liveLimits(app, settings, isAdmin)` (the table below), `gapRefreshBatch(words, pools,
  seen)` (the pool-generation requests, `{ word, poolType: "gap" }`), `TAB_PLAYER_KEY`, `GAP_REFRESH_MAX`.
- [useLivePlayer.js](../../../src/features/live/useLivePlayer.js): `useLivePlayer(profile)`, the player, kept while
  the account's id and username stay the same.
- [index.js](../../../src/features/live/index.js), the module's public surface, used only by the shell:
  `LiveChallenge` (loaded on demand), `getLiveApi` (the shell passes it to social for local invitations),
  `useLivePlayer`, `liveLimits`, `gapRefreshBatch`.
- The shell still keeps the list of read sentences and the pool generation; it calls `gapRefreshBatch` after a
  challenge is made and passes `liveLimits(...)` and the player to the Live screen.

## The player

- Online: the signed-in account, `{ id, name }` from the profile (`id`, `username`).
- Local mode (no accounts): each browser tab is its own player, `{ id: "tab-<6 letters>", name: "Player <10–99>" }`,
  kept in the tab's `sessionStorage` (`wh-live-player`), so a reload keeps it and another tab is someone else. When
  `sessionStorage` cannot be read or written, a new player is made each time.
- The same player is used by Live, friends (local mode) and the library ("me").
- The Live home says "Playing as <name>".

## Limits and defaults of a new challenge

The shell passes Live these `limits`, from the app settings (Admin -> Settings) and the player's own settings:

| Limit | The admin | A player |
| --- | --- | --- |
| `maxPlayers` | 10 | `liveMaxPlayers` (2–10, default 10) |
| `canCreate` | yes | unless `liveCreate` is "admin" |
| `maxHours` | 168 | `liveMaxHours` (1–168, default 168) |
| `defaultCount` | the player's own "Challenge questions" setting, else `liveDefaultQuestions` (5–30, default 10) | same |
| `defaultSeconds` | the player's own "Time per question" setting, else `liveDefaultSeconds` (default 20) | same |

How the Live screens use them:

- The Live home: "Send a link to a friend or a group of up to <maxPlayers>." With `canCreate` off: "Creating
  challenges is turned off right now. You can still join one." instead of the Create button, and a finished
  challenge offers no "Retry challenge".
- The create form: players from 2 up to `maxPlayers` (kept within 2–10), starting at the most; "The link works for"
  offers 1 hour, 6 hours, 1 day, 3 days and 7 days up to `maxHours`, starting at 1 day or the longest allowed below
  it; questions start at `defaultCount`, time at `defaultSeconds`. A Retry keeps the old challenge's choices where
  they fit.
- The database holds non-admins to the same limits (`live_create`).

## Fresh gap sentences after a challenge

- When a challenge is made, the words it was built from are checked: a word whose `gap` sentence has a blank (two or more `_`) and whose gap
  sentences (the authored ones and the ones written before) have all been read in the last 20 hours is "used up".
- Up to 8 used-up words get new gap sentences written in the background (pool generation,
  [pool-generation.md](../ai-media/pool-generation.md)), for the next matches. Nothing is shown; a failure is only
  logged.
- Every question a player answers in Live is remembered as read (the same list as practice uses), and the progress
  save is scheduled.

## Tests

| What | Where |
| --- | --- |
| The rules and `useLivePlayer`: the tab's player (kept, made again when it cannot be read or kept), the account, the limits for the admin and for players, used-up gap sentences (read recently or not, written ones, no blank, at most 8) | `tests/live-setup.test.jsx` |
| Live reached only through its index (by the shell), in no loop, using social only through its index | `tests/architecture.test.js` |
| The player per tab (kept across a reload), the create form's limits and defaults for the admin, the app's defaults and the player's own settings (local mode); a player held to the limits and the admin not (online, fake Supabase) | `e2e/specs/livesetup.cjs` |
| Two tabs play together in local mode | `e2e/specs/friendslive.cjs`, `e2e/specs/livelib.cjs` |

How the behaviour was kept: `livesetup.cjs` passes on the code before the move and after it. The rules were moved
unchanged and compared with the old shell code on random made-up inputs (15,000 checks, 1,418 of them with used-up
words; one-off, not kept). Deliberate breaks (13): 12 make a test fail; the 13th (`??` to `||` for the question
count) changes nothing for any value the settings allow (5–30 or none).

## Known Issues

- The app setting `liveDefaultQuestions` can be any number from 5 to 30, but the create form offers only 5, 10, 15,
  20, 25 and 30. With another number (for example 12) no choice is marked, yet the challenge asks for that number
  (found by `livesetup.cjs`, kept as is).
