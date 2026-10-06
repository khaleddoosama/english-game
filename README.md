# Word Hunter

An English vocabulary detective game: practice rounds, stories, a speed
round, a study dashboard, and Live Challenges: send a link to 1–9 friends,
everyone answers the same questions at their own pace, most right answers
wins and a tie goes to the faster player.

**Stack:** Vite + React · Supabase (accounts, data, realtime, storage) ·
Gemini (AI tools and pronunciation) through Vercel Functions · PWA.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest): engine, saves, routing, Live, import/export,
                 # grammar editor, dashboard numbers, settings, audit, AI log
```

Without Supabase settings the app runs in **local mode**: one local admin,
everything stored in this browser's IndexedDB, AI features off. Two tabs can
play a Live Challenge against each other. Copy `.env.example` to `.env.local`
and fill it in to use the real backend (AI calls need `vercel dev`, since
`/api` runs as Vercel Functions).

## Environment variables

| Name | Where | What |
|---|---|---|
| `VITE_SUPABASE_URL` | browser + server | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser + server | Supabase publishable key |
| `GEMINI_API_KEY` | server only | Google AI Studio key — **secret** |
| `SUPABASE_SECRET_KEY` | server only | Supabase → Settings → API Keys → Secret key — **secret**. The server writes the shared pronunciation cache and finishes AI log rows with it; players can't (0019). Without it, audio still plays but isn't cached, and AI log rows stay "unfinished" |
| `GEMINI_MODEL` | server | default `gemini-3.8-flash` |
| `GEMINI_TTS_MODEL` | server | default `gemini-3.8-flash-lite-tts` |
| `GEMINI_TTS_VOICE` | server | default `Kore` |
| `GEMINI_FALLBACK_MODELS` | server | tried in order when the main model is overloaded (503), rate-limited (429) or missing; default `gemini-3.5-flash-lite,gemini-flash-lite-latest` |
| `GEMINI_TTS_FALLBACK_MODELS` | server | same for speech; default `gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview` |
| `PLAYER_DAILY_AI_CALLS` | server | AI calls per player per day, default 150 (admin unlimited) |
| `CRON_SECRET` | server | protects `/api/keepalive` (Vercel sends it to cron calls) |

## Deploy (Vercel)

1. Vercel → **Add New → Project → Import** this repository (framework: Vite;
   `vercel.json` sets the rest: Frankfurt functions next to the database,
   caching headers, SPA rewrites, a daily keep-alive cron).
2. Add the environment variables above (Settings → Environment Variables),
   then redeploy.
3. Every push to a branch gets a preview URL; `master` is production.

Turn off **Vercel Authentication** for previews (Settings → Deployment
Protection) if friends should be able to open preview links.

## Supabase

Migrations live in `supabase/migrations` (apply in order). They create:

- `profiles` — username and role (`admin` / `player`) + leaderboard numbers.
  Other players' rows are readable only while ranks are on (0013)
- `content_items` / `content_meta` — one row per word, grammar rule,
  challenge, story or combo; only the admin writes
- `progress` (sections) and `mastery` (one row per word) — each player's own.
  Each section has a revision: `save_progress_v2` refuses a save made from
  an older copy, and the game merges the two devices' play (0016). The
  leaderboard score comes from the saved progress, not from the browser
- `reports` — the question, options, the player's answer, reason, who and
  when. Only the admin resolves or deletes; a player's edit keeps that
  decision, and a deleted report can't come back (0018)
- `item_key_aliases` and `content_drafts` (0017) — a renamed word or
  category moves every player's progress; big saves are staged and
  published in one step, refused if another admin saved meanwhile
- `live_challenges`, `live_players`, `live_answers`, `live_answer_keys` (0008)
  — Live Challenge: the answer keys never reach players; answers are judged
  and timed on the server; finished matches go to `live_results`. Since
  0020 a player sees no question before pressing Start, then one at a time;
  the creator's result is marked and doesn't count as a Live win. Since
  0023, once a challenge is over every member sees every player's answers
  (never before), and "Retry challenge" leaves the new challenge's code on
  the old one (`live_set_next`) so the other players are offered it
- `admin_audit` — every change with field-by-field before/after (0009);
  entries can be deleted only through `admin_audit_delete` / `admin_audit_clear`,
  which leave a note (0014)
- `app_settings` (0012) — sign-ups, maintenance, announcement, AI limits,
  Live limits, ranks, new-player defaults; enforced in the database.
  Sign-ups (0022): a limit per network the admin sets (default 30 in 10
  minutes), at most 200 in 10 minutes overall, one at a time; a new
  account is always a player. Accounts are made only by `register_player`,
  so keep Supabase → Authentication → "Allow new users to sign up" off
- `ai_usage` (daily counts) and `ai_calls` (0015) — one row per AI, voice or
  picture-copy call: who, when, feature, model, time, tokens, outcome.
  Only the server finishes a row (0019). Which AI features exist and which
  are admin-only is decided on the server (`api/_lib/tasks.js`)
- `analytics` schema views (0010, 0011) for data quality, read with
  `admin_analytics` / `admin_data_issues`. Rounds per day come from each
  player's daily totals (`dailyHistory` in the history section, 120 days),
  the same numbers the player's Study Dashboard shows (0021)
- storage buckets `word-images` (admin writes) and `tts` (only the server
  writes, 0019), private realtime channels `live:*`

Each feature has SQL tests in `supabase/tests/*.sql`. Run one as
`begin; <file>; rollback;`: it ends by raising `… TESTS PASSED`, and the
rollback leaves nothing behind. `supabase/ci/run-tests.sh` applies every
migration to an empty Postgres (with stand-ins for Supabase's own schemas)
and runs all the SQL tests; GitHub Actions (`.github/workflows/ci.yml`)
runs it, the unit tests and the build on every push.

Accounts are **username + password**. Sign-up goes through the
`register_player` function, so no email is involved. The admin account is
`khaled`; change its password from the Profile page.

**First run:** sign in as the admin → *Open Import & Export* → choose
`word-hunter-backup.json` → *Content and my progress* → *Restore*. That
loads all content for every player and the admin's own progress.

## Pages and links

Every page has its own address, and filters live in the query string, so a
refresh or a shared link opens the same view:
`/`, `/stories`, `/play`, `/stats?show=started`, `/badges`, `/live`,
`/live/<code>`, `/leaderboard`, `/profile`, `/settings`, `/data`, and
`/admin/<section>/<item>?filters`, e.g. `/admin/words?hasPicture=false`,
`/admin/grammar/g5`, `/admin/ai?status=error`.

## Course levels

Home can list the practice three ways (the toggle above the lessons, or
Settings → Home layout): **By lesson**, **By unit**, and **By course
level**. The last follows the Gateway course: a word's or grammar rule's
`level` holds its course level, `A1.1`, `A1.2`, `A1.3`, `A2.1` … `C2.3`
(three to a band: Gateway level 4 = A1.2, 5 = A1.3, 6 = A2.1, 7 = A2.2,
8 = A2.3, 9 = B1.1), and its `units` the session(s) it was taught in, as
in the Anki tags (`English::Memories-and-Fear` → `"Memories-and-Fear"`).
An import also accepts the Gateway form, `"Level-7"`, `"Gateway 7"` or the
whole tag `"English::Gateway::Level-7"`, and stores it as `A2.2`:

```json
{ "word": "Nostalgia", "category": "Emotions Psychology", "level": "A2.2", "units": ["Memories-and-Fear"], … }
```

Each level is a group in course order, with a card for the whole level and
one per session (in the order the words first appear); a new level shows
up as soon as a word has it. A plain `A1` – `C2` in `level` is the word's
difficulty, not a course level, so those words appear under "No course
level yet". A level the game can't read is listed as a warning when the
file is checked.

## Admin panel

Signed in as an admin, the **Admin** tab opens (Back to game and Log out
stay pinned in the sidebar):

- **Overview** — KPIs and charts over 7 / 30 / 90 days, each with a table view
- **Players** — search, filter, sort, CSV; a drawer per player; make admin,
  set password, reset progress, delete
- **Live challenges** — open challenges (end one early) and finished matches
- **AI usage** — totals, by feature / player / model, errors and refusals,
  and the call log with filters
- **Words** — filters in the address, bulk move / export / delete, a form
  editor per word (picture upload, AI fill, rename keeps progress)
- **Categories** — order, rename, merge, clean up
- **Reports** — every detail of a reported question; resolve, reopen, fix
- **Stories & more** — stories, combos and challenges
- **Grammar** — rules with lesson, level, question types and class
  accuracy; an editor with choose / right-or-wrong / fix questions, a
  learner preview, and AI-written questions to review
- **Data quality**, **Content health** — problems in the content, with fixes
- **Activity log** — who changed what and when, field by field; revert a
  change; delete selected entries or all of them
- **Settings** — app-wide rules (ranks, AI, Live, sign-ups, maintenance…)
- **Import & export** — backups, content files, words spreadsheet

Analytics and actions go through `admin_*` database functions; each
refuses anyone who isn't an admin.

## Layout

```
api/                 Vercel Functions: ai, tts, image-import, keepalive
src/engine/          game logic (moved verbatim from the original single file)
src/features/        session, live, admin, data (import/export), stats (dashboard),
                     settings, media, social (leaderboard/profile), auth, shell
src/lib/             supabase client, auth, repo (diff-based saves + caches), router,
                     app settings, ai, images
src/styles/          tokens, app, auth, ui, admin, live, data, stats, settings
supabase/migrations/ database schema and policies
supabase/tests/      SQL tests (run inside a rolled-back transaction)
tests/               Vitest unit tests
legacy/              the original single-file Claude artifact, for reference
```
