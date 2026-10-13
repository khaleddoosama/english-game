# Architecture

## Stack

- **Front end:** Vite + React 19, one PWA (`vite-plugin-pwa`). No router library: `src/lib/router.js` is a small history-based router.
- **Back end:** Supabase (Postgres, Auth, Realtime, Storage). Almost all logic is in Postgres functions (`security definer`) called with `supabase.rpc(...)`.
- **Serverless:** Vercel Functions in `api/` (`ai`, `tts`, `image-import`, `keepalive`). They hold the secrets (Gemini key, Supabase secret key).
- **AI:** Google Gemini, only through `/api/ai` and `/api/tts`.
- **Tests:** Vitest (`tests/`) and SQL tests (`supabase/tests/`).

## Two run modes

| | Online | Local mode |
|---|---|---|
| Trigger | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set | not set (`isLocalMode` in `src/lib/supabase.js`) |
| Content + progress | Supabase via `createSupabaseRepo` (`src/lib/repo.js`) | IndexedDB via `createLocalRepo` |
| Live Challenge | Supabase RPCs (`liveApi.js` → `supabaseApi`) + Realtime | `localStorage` + `BroadcastChannel` (several tabs) |
| AI | works | off ("AI features need the online version") |

The same UI runs on both, because each layer has **one interface, two implementations** (repo, live api, live transport).

## Folder map

```
api/                    Vercel Functions
  ai.js                 POST {prompt, task} → Gemini JSON text
  tts.js                POST {text} → audio url (cached in Storage)
  image-import.js       admin: copy an outside picture into Storage
  keepalive.js          daily cron: keeps the free Supabase project awake
  _lib/                 env, gate (quota check), gemini (fallback models), tasks (allowed AI features), publicFetch
src/main.jsx → app/App.jsx → app/WordHunter.jsx   (the big component: state + screens, ~2300 lines)
src/engine/
  data.js               module-level WORDS / GRAMMAR / CHALLENGES / LEVELS / BADGES, mastery helpers
  v2.js                 "V2" engine: content import/validate/merge, optionWords, makeQuestion, practice(), grade(), sessionEvidence()
  questions.js          older "adaptive" builders (Opposite, Who Am I, Two People, …), pools, speed round
  progress.js           weak words, insights, settings defaults, progress migration
  ai.js                 every AI prompt + response checks
src/features/           session, live, admin, data (import/export), stats, settings, media, social, auth, shell
src/lib/                supabase client, auth, repo (saves), progressMerge, router, appSettings, ai, images, idb
supabase/migrations/    0001 … 0025 (apply in order)
supabase/tests/         SQL tests; supabase/ci/run-tests.sh runs everything on empty Postgres
tests/                  Vitest unit tests (fakeSupabase.js is the test double)
legacy/                 the original single-file artifact (not used)
```

## How content reaches the screen

1. Admin saves content → `repo.saveContent` → RPC `content_save_v2` writes rows in `content_items` (one row per word / grammar rule / challenge / story / combo) and bumps `content_meta.version`.
2. A player opens the app → `repo.loadContent`: reads `content_meta.version`; if it equals the cached version in IndexedDB (`content-cache`), nothing else is downloaded; if not, only rows with `updated_at > syncedAt` are fetched (deleted rows are tombstones).
3. `mergeCustomData` (in `data.js`) fills the module variables `WORDS`, `GRAMMAR`, `CHALLENGES`, `LEVEL_ORDER`, then `rebuildDerived()` makes `LEVELS` (one per category) and `BADGES`.
4. Combos and stories are kept in React state (`customCombos`, `customStories`) and passed to `V2.practice` through `liveContent()`.

> `WORDS` etc. are **mutable module-level bindings**. Anything that imports them sees the new value after a merge. Do not copy them at import time.

## How a round works (short version)

`startPractice` (WordHunter.jsx) → `V2.practice(content, mastery, category, rng, quarantine, opts)` builds a queue of questions → `SessionView.jsx` shows them one by one → `V2.grade` checks each answer (typing answers that need judgement go to AI) → at the end `V2.sessionEvidence` updates each word's mastery record → `repo.saveProgress` sends only what changed. Details: [progress-and-mastery.md](progress-and-mastery.md).

## Security model

- **RLS on every table.** Players read content; only admins write it (`is_admin()`).
- **Players cannot write their profile row.** Score, streak and week points are computed in `save_progress_v2` from the saved progress (0016).
- **Live answers are judged on the server.** The answer key lives in `live_answer_keys` with no policies; only the functions read it (0008).
- **AI is gated by the database.** `/api/ai` first calls RPC `ai_gate` with the player's own token: signed in? admin-only task? AI switched off? daily quota? Every attempt is logged in `ai_calls` (0015). Only the server (secret key) can finish a log row (0019).
- **Which AI tasks exist is decided on the server** (`api/_lib/tasks.js`), not by what the browser sends.
- **Accounts:** username + password, created only by `register_player` (rate-limited, 0022). Keep "Allow new users to sign up" **off** in Supabase Auth.
- **Secrets** (`GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`) are server-only. Never prefix them with `VITE_`.

## Deploy

Vercel project, region `fra1` (next to the database), functions `maxDuration: 60`, SPA rewrite, cron `17 6 * * *` → `/api/keepalive`. Every branch push gets a preview URL; `master` is production. Environment variables are listed in the root `README.md`.

## CI

`.github/workflows/ci.yml` runs on every push: `npm run lint`, `vitest run`, `vite build`; and a second job applies all migrations to Postgres 16 and runs all SQL tests.

## Tests you can read to learn behaviour

| File | Teaches |
|---|---|
| `tests/engine.test.js`, `senses.test.js` | questions, options, words with several meanings |
| `tests/live.test.js`, `live-variety.test.js`, `live-review.test.js` | Live rules and question mix |
| `tests/api.test.js`, `gemini.test.js`, `ai-*.test.js` | AI endpoints, fallback, timeouts |
| `tests/import-export.test.js`, `grammar*.test.js` | content import and grammar |
| `tests/repo.test.js` + `fakeSupabase.js` | saving and merging progress |
| `supabase/tests/*.sql` | each database feature |
