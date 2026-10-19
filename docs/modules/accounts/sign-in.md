# Signing in, signing up and signing out (accounts)

How a person gets into the game and out again, and what the rest of the app learns about them. Part of the
[accounts](README.md) module. Decision: [ADR 0001](../../adr/0001-username-accounts.md) (username accounts).

Status: **Implemented** (current code). The behaviour below was written down before the code moved from
`src/lib/auth.jsx` to `src/features/auth`; the move kept it (see Tests).

## Files and interface

- [features/auth/authRules.js](../../../src/features/auth/authRules.js), no state: `USERNAME_RE`, `emailFor(username)`,
  `cleanUsername`, `usernameProblem`, `passwordProblem`, `signInErrorText`, `PROFILE_LOAD_ERROR`, `LOCAL_PROFILE`,
  `profileCacheKey`.
- [features/auth/AuthProvider.jsx](../../../src/features/auth/AuthProvider.jsx): `AuthProvider` (the sign-in state
  for the whole app) and `useAuth()`.
- [features/auth/LoginPage.jsx](../../../src/features/auth/LoginPage.jsx): the login page and the `Splash`.
- Reached only through [features/auth/index.js](../../../src/features/auth/index.js) (the shell and the Profile page).
- [lib/auth.js](../../../src/lib/auth.js): `accessToken()`, used by the AI and picture calls in `lib`.
- [lib/supabase.js](../../../src/lib/supabase.js): the Supabase client (none in local mode) and `isLocalMode`.
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
| The login page in a browser, with the app built for online mode and a fake Supabase: bad username, wrong password, another refusal, a taken name, a new account, the Admin tab for the admin only, the session across a reload, the offline start with and without the cached profile, sign-ups closed, a Live link, signing out | `e2e/specs/signin.cjs` |
| The rules: usernames, passwords, the placeholder email, the messages | `tests/auth-rules.test.js` |
| The sign-in state with a fake client: loading, the profile and its cache, the offline start, a refreshed token, a late answer for an older user, unsubscribing, every action and message, local mode, the access token | `tests/auth-provider.test.jsx` |
| Only through the index, no loop, uses only `lib` | `tests/architecture.test.js` |
| The account's database rules (sign-ups open or closed, limits, role) | `supabase/tests/signup_limits.sql` |

How the behaviour was kept: the rules were moved unchanged and the old and new code were compared on 3,000 random
made-up sign-in, sign-up and password changes (the same messages and the same calls to Supabase; one-off, not kept);
`signin.cjs` passes on the build before the move and after it. Deliberate breaks (15) each make a test fail.

**Gaps.** The real Supabase Auth is not run by any test (the browser spec answers its calls itself). The password form
on the Profile page and the sign-out wait for saves are in slice 2.

## Known Issues

- `MT-04`: the sign-in part is covered now (above); the session lifecycle part remains.
- A cached profile can show an old role while offline; the server still decides what the account may do.
