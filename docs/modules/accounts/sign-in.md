# Signing in, signing up and signing out (accounts)

How a person gets into the game and out again, and what the rest of the app learns about them. Part of the
[accounts](README.md) module. Decision: [ADR 0001](../../adr/0001-username-accounts.md) (username accounts).

Status: **Implemented** (current code), written down before the accounts code was moved or tested.

## Files and interface

- [lib/auth.jsx](../../../src/lib/auth.jsx): `AuthProvider` (the sign-in state for the whole app), `useAuth()`, and
  `accessToken()` (used by the AI and picture calls in `lib`).
- [lib/supabase.js](../../../src/lib/supabase.js): the Supabase client (none in local mode), `isLocalMode`,
  `USERNAME_RE`, `emailFor(username)`.
- [features/auth/LoginPage.jsx](../../../src/features/auth/LoginPage.jsx): the login page and the `Splash`.
- [app/App.jsx](../../../src/app/App.jsx): `Gate` picks the screen; `Game` builds the account's repo.

`useAuth()` returns `{ loading, user, profile, error, isAdmin, signIn, signUp, signOut, changePassword,
refreshProfile }`. `isAdmin` is `profile.role === "admin"`; it only decides what is shown (the server checks roles).

## Local mode

With no Supabase settings the app needs no account: at once `loading` is false, the user is `{ id: "local" }` and the
profile `{ id: "local", username: "local", role: "admin" }`. Signing out and refreshing the profile do nothing, there
is no Log out button, and `accessToken()` returns `null`. The browser specs run like this.

## Start-up (online)

1. `Gate` shows the splash while `loading` is true.
2. The saved session is read. No session: the login page.
3. A session: the profile row is read (`profiles`, by the user id) and cached in `localStorage` as
   `wh-profile:<id>`. The game is then mounted for that account (`Game`, keyed by the user id, so another account
   starts from a fresh game state).
4. The profile cannot be read (offline, server error): the cached profile is used if there is one (an offline start
   works). Without one, the login page shows "Couldn't load your account. Check your connection and try again."
5. Later session changes from Supabase (sign-in, sign-out, a refreshed token) are handled a moment after they come.
   A change that keeps the same user id (a refreshed token) changes nothing, so the game is not rebuilt. A change
   that arrives for an older user id while a newer one is loading is dropped.

## The login page

- Two tabs: "Sign in" and "Create account". "Create account" is shown only while sign-ups are open (app settings,
  `signupsOpen`; the cached copy is used until the server's arrives). When they are closed the page says "New
  accounts are closed right now. Ask the admin for an account."
- Opened from a Live link (`/live/<code>`), it says "You've been invited to a Live Challenge (<code>). Sign in, or
  create an account in a few seconds, to join." The address stays, so the challenge opens after signing in.
- The inputs: username (up to 20 characters, no auto-capitalise), password (at least 6, checked by the browser before
  the form is sent). While a request runs the button says "One moment…" and is disabled. Changing the tab clears the
  message.
- An error is shown under the button (`role="alert"`); a message from the start-up (above) is shown there first.

### Sign in (`signIn(username, password)`)

- The username is trimmed and lower-cased. If it is not 3–20 lower-case letters, digits or `_`: "Usernames are 3–20
  letters, numbers or _." (nothing is sent).
- Supabase is asked to sign in `<username>@wordhunter.test` with the password.
- Refused as invalid credentials: "Wrong username or password." Any other refusal shows Supabase's own message.
- Accepted: the session change above mounts the game.

### Create account (`signUp(username, password)`)

- The same username rule and message; a password under 6 characters: "Passwords need at least 6 characters."
- The database function `register_player(p_username, p_password)` creates the account (the database's own rules:
  [README](README.md#4-business-rules-and-permissions)). Its error message is shown as it is (for example "That
  username is taken", "New accounts are closed right now").
- Then the same sign-in as above.

## Signed in

- The header says "Hi <username>" (not for the local player). The admin also gets the Admin tab.
- `changePassword(password)` (Profile page): under 6 characters, "Passwords need at least 6 characters."; otherwise
  Supabase's message on failure.
- `refreshProfile()` reads the profile row again.

## Signing out

- The Log out button (header, Profile, Admin) first runs any waiting save and waits up to 5 seconds for running ones
  ([progress](../progress/README.md)); it shows "Logging out…" meanwhile.
- Then Supabase signs out, the session change shows the login page. A failure shows "Couldn't log out: <message>" and
  the player stays signed in.

## Tests

| What | Where |
| --- | --- |
| The account's database rules (sign-ups open or closed, limits, role) | `supabase/tests/signup_limits.sql` |

**Gaps (`MT-04`).** Nothing tests `AuthProvider`, the login page or these messages; the browser specs run in local
mode, so the login page is never seen.

## Known Issues

- `MT-04` (above).
- A cached profile can show an old role while offline; the server still decides what the account may do.
