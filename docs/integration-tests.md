# Integration tests (app code against a real PostgreSQL)

`tests/integration/*.test.js` run the app's own code (the library API, the
repo that saves progress and content, the id loader) against a PostgreSQL that
has **every migration applied**. Nothing in the database is mocked. The only
mocks are the browser's IndexedDB (one store per "device", `devices.js`) and,
by design, the AI service (these tests never call it).

## Run

Needs: Node 20+, `psql`, and a PostgreSQL 15+ **server you may create
databases on** (a throwaway one: Docker `postgres:16`, a local cluster, or a
Supabase local stack's database).

```bash
PGADMIN=postgres://postgres:postgres@localhost:5432/postgres supabase/ci/run-integration.sh
# one file:  ... run-integration.sh tests/integration/sharing.test.js
```

The script creates a fresh database, applies `supabase/ci/supabase-stub.sql`
and every migration, runs vitest (one file at a time, because the files share
the content tables), and drops the database. With `PGURL` unset the tests are
skipped, so `npm test` still works on any machine. With `PGURL` pointing at an
already-migrated database you can run `npx vitest run tests/integration
--no-file-parallelism` yourself; every test cleans up what it made (all names
carry a random tag, `cleanup(tag)`), and `harness.test.js` checks that.
`IT_TRACE=1` prints every SQL script the harness sends.

CI: the `database` job runs it after the SQL tests.

## How the identities work

`harness.js` stands in for supabase-js. Each call is one transaction that does
`SET LOCAL ROLE anon` (or `authenticated`) and sets `request.jwt.claims`
(`sub`, `role`), as PostgREST does. So row-level security and function grants
apply to every assertion. Players are created with the public sign-up function
as `anon` (`register_player`). The superuser connection is used only for
fixtures: promoting the first admin (the app cannot do that, on purpose),
reading rows to compare, moving a link's expiry into the past (the test's
clock), and cleanup.

## Scenarios

| File | What it proves |
| --- | --- |
| `harness.test.js` | the harness really acts as `anon`/`authenticated`; errors carry the SQLSTATE; a failed call leaves nothing; cleanup removes everything |
| `personal-word.test.js` | a word of my own is saved, a new session loads the whole card back, same word twice gives the same row, server-side limits, privacy |
| `content-rename.test.js` | a rename keeps mastery, pools, mix-ups, the library entry and the view membership; an offline device with the old name; edits keep the id and the player's own wording; concurrent admins are refused; a removed word comes back with its library entry |
| `progress-devices.test.js` | two devices save, the later one merges; nothing lost; revisions refuse stale writes; restore replaces; reset touches only the owner |
| `sharing.test.js` | share to a friend, by link, through the catalog: copies are independent, own words stay private, non-friends and strangers are refused, links expire and can be taken back |
| `isolation.test.js` | every table has RLS; anon reads nothing; no player reads or writes another's rows through tables or functions |
| `admin-denied.test.js` | every `admin_*` and admin-checking function refuses players and visitors; no way to become admin; the admin's own actions work, are audited, and delete a player who used the library |

## Defects these tests found (fixed in migrations 0037 and 0038; later decisions in 0039 and 0040: `docs/migrations/review-0037-0040.md`)

- A renamed word lost its place in players' libraries and views (the sync made
  a new word and deleted the old one). Fixed by `0037_rename_keeps_sense.sql`.
- An admin could not delete a player who had a view or a word of their own
  (foreign keys without cascade). Fixed by `0038_delete_player_library.sql`.

The migrations are in the repository only. They were applied to throwaway
databases, never to a real project. Review them before deploying.

## Known differences between server and local mirror

Removing or dropping what is not yours is a quiet no-op on the server and in the mirror (nothing changes, and
the answer is the same for a view that does not exist). Offers from a former friend now end on both sides
(migration 0040; the mirror ends them lazily, when the inbox is read).

## What this does NOT prove (stub PostgreSQL vs real Supabase)

The database is plain PostgreSQL plus `supabase-stub.sql`. So these tests do
**not** show:

- **GoTrue**: passwords, JWT signing and expiry, sessions, email, rate limits.
  A token is simulated by setting the claims; a forged or expired token is not tested.
- **PostgREST**: the harness builds SQL itself. Not covered: how PostgREST
  parses query strings, `db-max-rows`, exposed schemas, the schema cache,
  `Prefer` headers, column selection errors, HTTP status mapping.
- **Role details**: in Supabase `postgres` is not a true superuser and the
  default privileges of new projects may differ from the stub's
  (`alter default privileges ... grant all`). `SECURITY DEFINER` functions here
  run as a real superuser, so a function that works here could still fail on
  Supabase for lack of a privilege (for example on the `auth` schema).
- **Realtime and Storage**: the stub has empty tables for them; live
  challenges' realtime delivery and picture uploads are not tested.
- **Extensions and versions**: only `pgcrypto`; the real project's Postgres
  version and extensions can differ.
- **Edge Functions and Vercel API routes** (`api/`): not part of these tests.
- **Concurrency and load**: calls run one after another. A race between two
  truly simultaneous saves is only tested at the level of "stale revision is
  refused".
- **Production data and migration history**: the tests start from an empty
  database, so a migration that fails on existing rows is not found.

To close the gap, run the same suite against a Supabase local stack
(`supabase start`) by pointing `PGURL` at its database; the harness still
simulates PostgREST there, so a final check through the real API
(`supabase-js` with real sign-in) remains manual.
