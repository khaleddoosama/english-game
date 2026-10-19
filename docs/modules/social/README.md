# Module: social

Friends, friend requests, the leaderboard, the profile page, and the numbers behind the navigation badges. Proposed boundary, see [module-map.md](../../architecture/module-map.md). What the player sees, step by step, and the module's public surface (`index.js`): [friends-and-ranks.md](friends-and-ranks.md).

## 1. Purpose and scope

**Purpose.** Let players find each other by username, see how they compare, and keep a record of their Live results.

**Responsibilities (Implemented)**

- Friend requests by exact username, accept or decline, remove, list.
- Invitations to Live challenges for friends (the invitation functions are called from the Live screens).
- Leaderboard (all time, this week, Live wins) and a friends-only weekly board.
- Profile page: player numbers, Live history, change password, backup copy and download, links to library, catalog, friends, stats, settings and data.
- Waiting counts (requests and invitations) for the navigation badges, with polling.
- A local mode implementation for tabs of one browser.

**Out of scope**

- Account creation and roles ([accounts](../accounts/README.md)).
- Live play ([live](../live/README.md)); sharing views ([library](../library/README.md) checks friendship through this module's functions).
- Computing the leaderboard numbers ([progress](../progress/README.md) writes them).

## 2. Public operations

The friends API in [friendsApi.js](../../../src/features/social/friendsApi.js).

| Operation | Input | Output |
| --- | --- | --- |
| `list()` | none | friends, requests in, requests out |
| `request(username)` | username | status (a request, or an accepted friendship when the other already asked) |
| `respond(userId, accept)` | id, flag | nothing |
| `remove(userId)` | id | nothing (also takes back an unanswered request) |
| `counts()` | none | `{requests, invites}` |
| `invite(code, userIds)`, `myInvites()`, `dismissInvite(code)`, `invitesSent(code)` | | Live invitations |
| `fetchLeaderboard(kind)` | `all`, `week` or `live` | up to 50 profile rows |
| `fetchFriendsBoard(ids)` | friend ids | rows sorted by this week's points |
| `fetchLiveHistory(userId, limit)` | id | the player's Live results |
| `useSocialCounts(api, enabled)` | | `{counts, refresh}` |

## 3. Files, screens and database objects

- Screens: [FriendsPage](../../../src/features/social/FriendsPage.jsx), [Leaderboard](../../../src/features/social/Leaderboard.jsx), [ProfilePage](../../../src/features/social/ProfilePage.jsx), [AddFriendButton](../../../src/features/social/AddFriendButton.jsx).
- Public surface: [index.js](../../../src/features/social/index.js) (see [friends-and-ranks.md](friends-and-ranks.md#files-and-interface)).
- Rules and hooks: [socialRules.js](../../../src/features/social/socialRules.js), [useSocial.js](../../../src/features/social/useSocial.js), [useSocialCounts.js](../../../src/features/social/useSocialCounts.js), [useLeaderboard.js](../../../src/features/social/useLeaderboard.js), [useFriendsList.js](../../../src/features/social/useFriendsList.js), [useLiveHistory.js](../../../src/features/social/useLiveHistory.js).
- Data: [friendsApi.js](../../../src/features/social/friendsApi.js), [socialApi.js](../../../src/features/social/socialApi.js).
- Tables: `friendships`, `live_invites`, `profiles` (leaderboard columns), `live_results`.
- Functions: `friend_request`, `friend_respond`, `friend_remove`, `friends_list`, `are_friends`, `friend_count`, `social_counts`, `live_invite_friends`, `live_my_invites`, `live_invite_dismiss`, `live_invites_sent`, `leaderboard_visible`.
- Migrations 0013, 0024, 0025, 0043 (signals to each player: triggers `friendships_signal`, `live_invites_signal`; policy "players read their own signals").

## 4. Business rules and permissions

- Friend requests go by exact username and need an answer. Asking someone who has already asked you means yes. Limits: 100 friends; 20 requests you sent that are still waiting; up to 20 friends invited to a challenge in one call.
- Declining or being removed: the asker waits a week before asking again; the one who removed does not wait; a request the sender took back has no wait. Ending a friendship keeps the row (`removed` or `cancelled`, with who ended it).
- Both tables are readable only by the people they name and are written only by the functions.
- Ranks (admin setting): with ranks off, a player can read only their own profile row, so scores of others cannot be fetched at all; the admin always can. The Ranks tab and the leaderboard route are hidden.
- The weekly board compares the profile's `week_start` with the current week's Monday, which the **browser** computes in the player's local time.
- Only username and summary numbers of other players are visible, never their progress.

## 5. Data flow

- Pages call the friends API (RPC) or read `profiles` directly (leaderboard).
- Counts are fetched when the game opens, every 45 seconds, when the tab becomes visible or gets focus, (in local mode) when another tab changes data, and (online, with migration 0043) at once when the database signals a friend request, answer or removal, or an invitation, on the player's private channel `user:<id>`. A failed check keeps the last numbers.
- The profile's Live history reads `live_results` for the signed-in player.

## 6. Failure, retry, cancel, offline

- Friends need a connection; offline messages say so. No automatic retry; the player repeats the action.
- Counts and the leaderboard fail quietly (old numbers or an empty list).
- The server's rule messages (limits, waiting weeks) are shown as they are.

## 7. Tests

| Check | Where |
| --- | --- |
| Local friends rules and messages | [tests/friends.test.js](../../../tests/friends.test.js) |
| Server rules: requests, answers, soft removal, limits, invitations | [supabase/tests/friends.sql](../../../supabase/tests/friends.sql) |
| Rank visibility | [supabase/tests/ranks.sql](../../../supabase/tests/ranks.sql) |
| Profile page with the catalog link | [tests/profile-catalog.test.jsx](../../../tests/profile-catalog.test.jsx) |
| Two tabs: ask, accept, invite, join | [e2e/specs/friendslive.cjs](../../../e2e/specs/friendslive.cjs) |
| Badges, Ranks, the add-friend button, the Friends page and the Live history, online with a fake Supabase | [e2e/specs/social.cjs](../../../e2e/specs/social.cjs) |
| Rules and hooks | [tests/social-rules.test.js](../../../tests/social-rules.test.js), [tests/social-hooks.test.jsx](../../../tests/social-hooks.test.jsx) |

**Gaps.** The leaderboard is tested against a fake Supabase, not the real database (its rules: `ranks.sql`); the weekly board boundary across time zones is untested; local and online friends implementations are not compared (`MT-05`).

## 8. Example journey

Dana (synthetic) adds Omar as a friend.

1. Dana opens Friends and types `omar`. `friend_request` creates a pending request; the database signals both of them, and Omar's Profile tab shows a badge "1" within about a second (without migration 0043: at his next count check, within 45 seconds, or when his tab regains focus).
2. Omar opens Friends and accepts. They are friends. Dana can now share a view with Omar or invite him to a challenge.
3. Later Omar removes Dana. The row stays (marked removed by Omar). Dana cannot ask again for a week; Omar can.

## 9. Status

**Implemented.** Everything above. Since 2026-10-19 this module does not import Live: the app passes the Live API
in (`useSocial({ liveFor })`), which the local invitations use; the invitation functions stay here (they live in the
friends API and the `social_counts` function counts them with the requests). This ended the `live`/`social` loop.

**Planned**

- Phase 3: leaderboard numbers bounded or computed on the server.

**Known Issues**

- `PE-01` the numbers on the leaderboard are as honest as the client that sent them (Confirmed).
- `MT-05` local and online implementations are not compared.
- The week boundary uses the player's local clock (Assumption: harmless for friends in one region, uneven across time zones).
