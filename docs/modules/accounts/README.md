# Module: accounts

Who is signed in, what role they have, and the rules for creating accounts.
Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decision: [ADR 0001](../../adr/0001-username-accounts.md).

## 1. Purpose and scope

**Purpose.** Let a person sign in with a username and password, know whether they are a player or the admin, and give the rest of the app a token to call the server with.

**Responsibilities (Implemented)**

- Sign in, sign up, sign out, change own password.
- Load and cache the profile (username, role).
- Hand out the access token for calls to the app's own `/api` functions.
- Enforce sign-up rules in the database: open or closed, rate limits, role always `player`.

**Out of scope**

- Leaderboard numbers on the profile row (module [progress](../progress/README.md) writes them; [social](../social/README.md) reads them).
- Admin actions on other accounts: set role, set password, reset progress, delete (module [admin](../admin/README.md); the database functions are listed below for reference).
- Friends and sharing ([social](../social/README.md)).

## 2. Public operations

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `useAuth()` | none | `{ loading, user, profile, error, isAdmin, signIn, signUp, signOut, changePassword, refreshProfile }` | From [auth.jsx](../../../src/lib/auth.jsx). |
| `signIn(username, password)` | text, text | resolves, or throws a readable error | Username is trimmed and lowercased, checked against the pattern, then mapped to the placeholder email. |
| `signUp(username, password)` | text, text | resolves after signing in | Calls `register_player`, then `signIn`. |
| `signOut()` | none | resolves | No-op in local mode. |
| `changePassword(password)` | text | resolves or throws | Minimum 6 characters. |
| `accessToken()` | none | token or `null` | Used by [lib/ai.js](../../../src/lib/ai.js) and [lib/images.js](../../../src/lib/images.js). |
| `register_player(p_username, p_password)` | text, text | nothing, or an error with a readable message | Database function; the only way an account is created. |

## 3. Files and database objects

- Files: [lib/auth.jsx](../../../src/lib/auth.jsx), [lib/supabase.js](../../../src/lib/supabase.js), [features/auth/LoginPage.jsx](../../../src/features/auth/LoginPage.jsx) (also exports `Splash`), the `Gate` in [app/App.jsx](../../../src/app/App.jsx).
- Screens: login page, splash, the account error shown on the login page, the password form on [ProfilePage](../../../src/features/social/ProfilePage.jsx).
- Tables: `auth.users`, `auth.identities`, `profiles` (identity columns: id, username, role), `signup_log`.
- Functions: `register_player` (migrations 0002, 0012, 0022), `handle_new_user` (trigger), `is_admin`, `require_admin`, `request_ip`; admin-side: `admin_set_role`, `admin_set_password`, `admin_delete_player`.
- Policies: profile rows are readable by the owner; by everyone signed in while ranks are on; always by the admin (migration 0013). Players cannot update their own profile row (migration 0016).

## 4. Business rules and permissions

- Username: 3 to 20 characters of lowercase letters, digits and `_`. Checked in the browser and in `register_player`.
- Password: at least 6 characters (browser); 6 to 72 (database).
- Sign-up can be switched off by the admin (the sign-up tab disappears and the database refuses).
- Rate limits: per network (admin sets it, default 30 in 10 minutes, between 5 and 200), 200 in 10 minutes for the whole app, and one sign-up at a time. The network is identified by a hash of the caller's address kept for one day.
- A new account is always a `player`. Only the admin can change a role.
- Supabase's own "Allow new users to sign up" must stay off, otherwise these rules can be bypassed (deployment setting, not enforced by code).
- Role checks that matter are in the database (`require_admin`, `is_admin`, row policies). The `isAdmin` flag in the browser only decides what to show.

## 5. Data flow

1. [AuthProvider](../../../src/lib/auth.jsx) reads the Supabase session, then fetches the profile row. It saves the profile in localStorage as `wh-profile:<id>`.
2. A token refresh does not rebuild the game: state changes only when the user id changes.
3. `Gate` renders the splash while loading, the login page with no user, and `Game` (keyed by user id) with a user.
4. `Game` builds the repo for the account and renders [WordHunter](../app-shell/README.md).
5. Local mode skips all of this: a fixed local admin.

## 6. Failure, retry, cancel, offline

- Wrong password: "Wrong username or password." Other server messages are shown as they are (for example "That username is taken", "New accounts are closed right now").
- Profile fetch fails: if a cached profile exists it is used (offline start works). If not, the user is signed out and the login page shows "Couldn't load your account. Check your connection and try again."
- There is no automatic retry; the player submits again.
- A cached profile can show an old role while offline. The server still decides what the account can do.
- No password reset by email (by design, ADR 0001). The admin can set a password.
- Sign-out: the game first waits up to 5 seconds for pending saves (see [progress](../progress/README.md)), then signs out; a failure shows a toast and the player stays signed in.

## 7. Tests

| Check | Where |
| --- | --- |
| Sign-up open/closed, per-network and global limits, role always player, one at a time | [supabase/tests/signup_limits.sql](../../../supabase/tests/signup_limits.sql) |
| Profile visibility with ranks on and off | [supabase/tests/ranks.sql](../../../supabase/tests/ranks.sql) |
| Every other SQL test creates players with `register_player` | `supabase/tests/*.sql` |

**Gaps.** No automated test for `AuthProvider`, `LoginPage` or the error messages; the browser specs run in local mode, so sign-in is never exercised. `MT-04`.

## 8. Example journey

Sam (synthetic user `sam_01`) gets a Live link, `/live/K7M2QX`, from a friend and opens it signed out.

1. The login page shows "You've been invited to a Live Challenge (K7M2QX)". The address stays the same.
2. Sam taps "Create account", enters `sam_01` and a password. The browser calls `register_player`, then signs in with `sam_01@wordhunter.test`.
3. `AuthProvider` loads the profile; `Gate` mounts the game for Sam; the router still has `/live/K7M2QX`, so the challenge opens.
4. If sign-ups were closed, step 2 shows "New accounts are closed right now. Ask the admin for an account." and Sam asks the friend or the admin.

## 9. Status

**Implemented**

- Username/password accounts, sign-up rules in the database, cached profile for an offline start, local mode with a fixed admin.

**Planned** (from the [roadmap](../../architecture/roadmap.md))

- Phase 0: automated tests for sign-in and sign-up messages with a fake client.

**Known Issues**

- `MT-04`: no automated auth tests (above).
- `PE-03`: maintenance mode is checked in the browser only (see [app-shell](../app-shell/README.md)).
