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
| `progress-ops.test.js` | a save with an operation id is applied once (two devices, a lost answer, a closed page, concurrent deliveries, other players, a refused write records nothing, old clients) |
| `isolation.test.js` | every table has RLS; anon reads nothing; no player reads or writes another's rows through tables or functions |
| `admin-denied.test.js` | every `admin_*` and admin-checking function refuses players and visitors; no way to become admin; the admin's own actions work, are audited, and delete a player who used the library |

## Defects these tests found (fixed in migrations 0037 and 0038; later decisions in 0039 and 0040: `docs/migrations/review-0037-0042.md`)

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

## Real stack (GoTrue + PostgREST + supabase-js)

`tests/realstack/` runs the changes of 0039-0042 and the save path through Supabase's own images, which the
harness above does not do: players sign in through **GoTrue** (users made by `register_player`, as the app does),
**PostgREST** turns the JWT into a role and answers with its own status and error codes, the database is
**Supabase's Postgres 15.8** with its own roles and auth schema, and the client is **supabase-js**.

```bash
tests/realstack/up.sh                      # docker: supabase/postgres, gotrue, postgrest from Docker Hub (db 54331)
node tests/realstack/proxy.cjs &           # the gateway on 54330 (/auth/v1, /rest/v1)
REALSTACK_URL=http://127.0.0.1:54330 REALSTACK_PGURL=postgres://supabase_admin:postgres@127.0.0.1:54331/postgres \
REALSTACK_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
  npx vitest run tests/realstack --no-file-parallelism
```

Without the variables the tests are skipped. The last test rolls 0037-0042 back and forward on that database.
Not in the stack: Realtime, Storage, Studio, the Vercel functions, the app's screens. The migrations need some things from
Realtime and Storage (`realtime.messages`, `realtime.topic()`, `realtime.send()` for the signals of migration 0043, the
`buckets` columns): `up.sh` creates them by hand, the same way as `supabase/ci/supabase-stub.sql` (keep the two in step).
`realtime.send()` was missing there until 2026-10-20, so on a fresh real stack the 0043 triggers failed; the SQL block was
checked on its own after the fix, the whole stack (Docker) was not run again. Tried again on 2026-10-21: the Docker
daemon started, but the images could not be fetched (Docker Hub: 429 Too Many Requests; `public.ecr.aws`: layer
downloads refused). Real stack is not part of CI.

**Planned** (2026-10-21): a CI job `realstack` on every push and pull request runs the same commands on a GitHub
runner (which can fetch the images) through `tests/realstack/run-ci.sh`: it waits for GoTrue and PostgREST, runs the
tests, and fails if any of them is skipped or none ran, so a missing variable cannot pass as green.
**Open gaps:** run the whole real stack again with 0043; a test that the Realtime service delivers a signal to a
player (no test runs the Realtime service; it was checked by hand once, `docs/modules/live/README.md`). This is still
not a real project: see `docs/migrations/review-0037-0042.md`, "Not verified".

## Upgrade and rollback check

`supabase/ci/check-upgrade.sh` (CI job `database`) builds a database at 0036 with made-up data, applies 0037-0042,
checks data and behaviour, rolls them back and compares the whole schema with the one before, applies them again,
and then does the same for **0043** on top of 0042: the schema changes as committed
(`supabase/ci/expected/schema-after-0043.txt`), `supabase/rollback/0043_down.sql` gives back exactly the 0042 schema,
the policy on `realtime.messages` (outside the fingerprint, which reads `public`) is there and then gone, and 0043
applied again gives the same schema. The read-only comparison for a real project (`preflight-compare.sh`) still knows
the 0037-0042 states only.

The browser spec `e2e/specs/saveclose.cjs` (real Chromium tab closed during a save, the repo bundled for the browser, real
IndexedDB, PostgreSQL behind the harness) needs `PGURL` and is skipped without it; CI runs it in the `database` job.
