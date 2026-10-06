# Personal libraries and friends

Work is isolated on `feature/personal-library-friends`. Do not merge or apply
these migrations to the production database until the owner requests it.

## Behaviour

- `/library` starts empty for each online account, including admins. Search the
  shared catalogue, add a word, remove it without deleting saved mastery, or
  select up to 100 words to share with an accepted friend.
- Existing words are reused immediately. `/api/library-word` verifies the
  bearer token and queries Supabase before using the existing AI quota gate.
  Missing words receive English-only structured learning content, including
  parts of speech, CEFR level, register, units, meanings, multiple examples,
  gap sentences, hints, common mistakes, collocations, word families and
  reliable synonyms/antonyms. Empty linguistic relations are allowed rather
  than inventing them. Images are not fabricated.
- Generation is validated on the server; invalid, answer-leaking, incomplete,
  or low-confidence output is rejected. `store_generated_word` is callable
  only by the server role, atomically rechecks normalized headwords and attaches
  the shared record to the authenticated account. Concurrent requests cannot
  overwrite an existing definition or create a casing duplicate.
- Bulk entry accepts comma/newline-separated words or phrases (up to 100,
  including batches of 20). One database call selects every published match
  before any AI work. Duplicates are collapsed; each row shows its outcome.
  Retry keeps successful rows and already-generated entries, including when
  only saving a group failed. Missing-word generation follows the existing
  account quota, so a batch can finish partially when the allowance runs out.
- Personal words and grammar use the existing full editors and JSON view.
  Manual authoring, validated JSON import/export, categories, multiple units,
  filters and grouping selected words affect only `personal_content_items`
  belonging to the caller. Shared catalogue definitions are never edited by
  these actions. Imported matching keys replace the personal version.
  Existing headwords/rule IDs stay fixed in the editor to preserve progress.
  Admin-only image uploading remains in the admin editor; image metadata can
  be retained in personal JSON.
- Grammar can be selected from the catalogue, manually authored, or prepared
  by `/api/library-grammar`. This endpoint uses the player gate and bounded,
  server-owned instructions; it returns a checked draft without publishing.
  Review the explanation, examples, common mistakes and choose/judge/fix
  questions before saving. The editor can request additional AI questions.
- Practice uses selected words and grammar from their original catalogue
  units, plus personally authored/selected rules. Automatic rules can be
  explicitly removed. Grammar-only categories also support practice. A library with
  one word uses typing questions so it can still be practised. Old sessions with
  unselected word targets or removed grammar rules are not resumed. The admin editor keeps the complete
  catalogue separately so changing a personal selection cannot delete shared
  content. Saved word mastery is retained when a selection is removed.
- `/friends` supports requests, accepting, declining, cancelling and removing
  friends; incoming word sets require an explicit Add action. The server
  snapshots the sender's actual personal versions, including private words
  and groups, rather than trusting a client-supplied payload. Acceptance is
  atomic and preserves the recipient's existing personal edits. Challenge hosts
  can send in-app invitations from the waiting room. Recipients open the usual
  join flow; invitations do not silently enrol them or expose answer keys.
- Ranks remain available from Profile. Local development mode retains existing
  local content and explains that shared libraries/friends need online accounts.

## Isolated preview setup

1. Use a separate Supabase project/branch containing the existing migrations and
   catalogue. Apply `20261006180323_personal_library_friends.sql` and
   `20261006183906_personal_content_workspace.sql` there.
2. Set preview `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SECRET_KEY` (or the existing service-role
   key variable) to that preview project. Keep the database secret server-only.
   `GEMINI_API_KEY` and the existing model/quota settings are reused.
3. Run `npm ci`, `npm test`, `npm run build`, and the existing
   `supabase/ci/run-tests.sh` against an empty test Postgres. The new SQL suite
   checks allow/deny cases for library ownership, friend requests, shares,
   invitations and server-only generation.
4. Test two independent accounts: each starts empty; add an existing word,
   generate a missing word, remove/re-add it, accept friendship, share words,
   accept the shared set, create a challenge and open a received invitation.
   Also paste a batch of 20 words with duplicates, a phrase and an invalid
   token; assign a category and multiple units, retry failed rows, edit a
   private definition and import/export content. Add grammar manually and
   with AI, and practise a grammar-only category. Verify another account
   retains the global definition and cannot read/edit personal rows. Share
   an authored word, accept it and confirm existing recipient edits survive.
   Verify both accounts' practice and saved mastery stay independent.

No production migration or production deployment is included in this branch.
AI correctness still depends on the model; malformed or low-confidence output
fails closed and the admin can inspect/edit the resulting shared catalogue.

## Backup and rollback preparation

See [the backup/rollback runbook](backup-rollback.md) and the read-only
`ops/backup-inventory.sql`. They prepare recovery and restore verification;
no production backup, restore, schema change or deployment was performed.
