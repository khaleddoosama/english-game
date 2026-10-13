# Word Hunter — notes for Claude

English vocabulary game (Gateway course). Vite + React 19 PWA, Supabase
(auth, Postgres, realtime, storage), Gemini through Vercel Functions.
`README.md` has the full feature list, env vars and deploy steps — read it
before big changes. This file is the short "how to work here" guide.

## Commands

```bash
npm run dev        # Vite on :5173; no Supabase env = local mode (IndexedDB, AI off)
npm test           # Vitest (tests/*.test.js[x]) — ~270 tests, ~10 s
npm run lint       # ESLint: undefined names, hooks order, unused vars
npm run build      # Vite build + PWA service worker
supabase/ci/run-tests.sh   # all migrations + SQL tests on an empty Postgres (needs PGURL)
```

CI (`.github/workflows/ci.yml`) runs lint, tests, build, and the SQL tests on
every push. Run lint + tests + build before pushing; all three must be green.

## Map

| Path | What |
|---|---|
| `api/*.js` | Vercel Functions (`ai`, `tts`, `image-import`, `keepalive`, `hello`). `_lib/gate.js` checks the caller's token + daily quota through the DB; `_lib/tasks.js` is the **server-side** list of AI features and who may use them |
| `src/engine/` | Game logic, no React: `questions.js` (question builders), `v2.js` (offline session engine), `progress.js` (mastery, badges, settings), `data.js` (constants, runtime content), `ai.js` (prompts) |
| `src/app/WordHunter.jsx` | Main app shell, ~2300 lines. Biggest file; split carefully |
| `src/features/*` | UI by feature: `session`, `live`, `admin` (+`sections`, `editors`), `social`, `stats`, `data` (import/export), `settings`, `media`, `auth`, `shell` |
| `src/lib/repo.js` | Single data layer: Supabase impl and local (IndexedDB) impl behind one interface. Diff-based saves, content cache by version |
| `src/lib/progressMerge.js` | Pure 3-way merge of progress from two devices |
| `src/lib/router.js` | Tiny History-API router; filters live in the query string |
| `supabase/migrations/` | Numbered SQL (`0001`–`0025`), applied in order |
| `supabase/tests/*.sql` | One SQL test per feature, each ends with `... TESTS PASSED` |
| `tests/` | Vitest. `fakeSupabase.js` re-implements the DB functions in JS |
| `legacy/`, `imports/`, `word-hunter-backup.json` | Old single-file version, import samples, a backup. Not part of the build |

## Rules that matter

- **The server decides, not the browser.** Admin checks, AI quotas, Live
  answer keys, sign-up limits, and leaderboard scores are enforced in
  Postgres functions (`SECURITY DEFINER`, each calls `require_admin()` or
  checks `auth.uid()`). Never trust a flag the client sends.
- **Tables are written only through functions** when the migration says so
  (`save_progress_v2`, `content_save_v2`, `live_*`, `friend_*`, `register_player`).
  Tables with RLS on and no policy (`content_drafts`, `live_answer_keys`,
  `report_tombstones`, `signup_log`) are on purpose: only functions touch them.
- **New AI feature** = add it to `api/_lib/tasks.js` (name, `maxChars`,
  `adminOnly`), then call `/api/ai` with that exact task name. Unknown names
  are refused.
- **Secrets**: `GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET` are
  server-only; never prefix with `VITE_`. The Supabase URL + publishable key in
  `.env.example` are public by design.
- **Progress keys** (word text, grammar id) are the identity of a player's
  mastery. Renaming a word must go through `item_key_aliases` /
  `apply_item_renames`, never a plain edit.
- Keep a local-mode path working: anything in `repo.js`, `liveApi.js`,
  `friendsApi.js` needs both the Supabase and the local branch.

## Conventions

- JavaScript (no TypeScript), ES modules, double quotes, 2-space indent.
- Comments explain *why* and the rule, in plain English; files start with a
  short header comment saying what they do. Match this when adding files.
- Pure logic goes in `engine/` or `*Rules.js` / `*Engine.js` files and gets a
  Vitest test. UI files stay thin.
- Vercel function files export `GET` / `POST` handlers returning `json(status, body)` from `api/_lib/env.js`.
- **New migration**: next number (`0026_name.sql`), idempotent where
  possible, plus a `supabase/tests/<name>.sql` that raises `... TESTS PASSED`.
  Never edit an applied migration.
- Commit style: short imperative subject ("Add GET /api/hello endpoint").

## Database (live project `word-hunter`, eu-central-1)

Read `docs/REVIEW.md` for the current state, known drift between the repo's
migrations and the live migration list, and the open to-do list. Use the
Supabase MCP for read-only checks (`list_tables`, `get_advisors`); apply schema
changes as a migration file in the repo first, then to the project.
