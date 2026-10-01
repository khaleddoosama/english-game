# Word Hunter

An English vocabulary detective game: practice rounds, stories, challenges,
a speed round, and Live Challenge matches against friends on their own
devices.

**Stack:** Vite + React · Supabase (accounts, data, realtime, storage) ·
Gemini (AI tools and pronunciation) through Vercel Functions · PWA.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine, save-layer and server-helper tests
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
| `GEMINI_MODEL` | server | default `gemini-3.8-flash` |
| `GEMINI_TTS_MODEL` | server | default `gemini-3.8-flash-lite-tts` |
| `GEMINI_TTS_VOICE` | server | default `Kore` |
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

- `profiles` — username and role (`admin` / `player`) + leaderboard numbers
- `content_items` / `content_meta` — one row per word, grammar rule,
  challenge, story or combo; only the admin writes
- `progress` (sections) and `mastery` (one row per word) — each player's own
- `reports`, `live_rooms`, `live_results`, `ai_usage`
- storage buckets `word-images` and `tts`, private realtime channels `live:*`

Accounts are **username + password**. Sign-up goes through the
`register_player` function, so no email is involved. The admin account is
`khaled`; change its password from the Profile page.

**First run:** sign in as the admin → *Open Import Center* → upload
`word-hunter-backup.json` → tick *Also restore progress* → *Restore backup*.
That loads all content for every player and the admin's own progress.

## Layout

```
api/                 Vercel Functions: ai, tts, image-import, keepalive
src/engine/          game logic (moved verbatim from the original single file)
src/features/        session, live, admin, media, social (leaderboard/profile), auth, shell
src/lib/             supabase client, auth, repo (diff-based saves + caches), ai, images
src/styles/          tokens, app, auth, ui
supabase/migrations/ database schema and policies
legacy/              the original single-file Claude artifact, for reference
```
