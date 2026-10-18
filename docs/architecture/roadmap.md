# Word Hunter: roadmap

Ranked problems and a step-by-step plan. Everything here is a **Planned** proposal. Nothing in this file has been done, and writing it changed no behaviour and no database schema.

- How the app works today: [current-state.md](current-state.md)
- Proposed module boundaries: [module-map.md](module-map.md)
- Decisions already taken: [docs/adr](../adr)

## Problem register

Ranked by impact on, in this order: **L** learning correctness, **D** data saving, **P** permissions, **M** ease of change. Ratings are High, Med, Low or "-" (not affected). Evidence says how sure we are.

| Evidence | Meaning |
| --- | --- |
| Confirmed | Reproduced with a test or a probe on a throwaway database with synthetic data (details in [current-state.md](current-state.md#9-verification-performed-for-this-document)). |
| By reading | Follows from the code; not executed end to end. |
| Suspected | A likely consequence that needs a check before anyone fixes it. |

| Rank | ID | Problem | L | D | P | M | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `DP-01` | Renaming a word moves players' progress but not their library links. | Med | High | - | - | Confirmed; fixed for new renames by migration 0037 (in production since 2026-10-18); old renames not repaired |
| 2 | `LC-01` | Two definitions of "mastered": words use session evidence, grammar and challenge items use a simpler rule. | High | - | - | Med | By reading |
| 3 | `LC-02` | AI-written practice sentences enter a player's pool without a review when the AI quality check is unavailable. | Med | Low | - | - | By reading |
| 4 | `DP-02` | `sense_create` has one caller (admin "Add to Collection") and `library_patch` and notes have none; player-owned words and patches have no screen, and nothing feeds private words or patches into the playable content. | Low | Med | - | Med | By reading (orphan copy: Suspected) |
| 5 | `DP-03` | The dictionary copy is refreshed by a best-effort call from the admin's browser; a failure is only logged. | Low | Med | - | Med | By reading |
| 6 | `DP-04` | Mastery rows have no revision; on a save the server keeps the record with more answers, so two devices rely on the client merge. | Med | Med | - | - | By reading |
| 7 | `PE-01` | The leaderboard score, streaks and mastered count are taken from what the client sends. | - | - | Med | - | Confirmed |
| 8 | `PE-02` | A player can write their own `progress` and `mastery` rows directly, bypassing revision checks. | Low | Low | Low | - | Confirmed (on the local stub; re-check on the real project) |
| 9 | `PE-04` | `/api/ai` forwards any prompt text within the task's size limit, so a signed-in player can use the AI as a general chat within the daily quota. | - | - | Low | - | By reading |
| 10 | `DP-05` | Question reports live in two places (a progress section and the `reports` table) and are reconciled on load. | Low | Med | - | Med | By reading |
| 11 | `MT-01` | [WordHunter.jsx](../../src/app/WordHunter.jsx) is one component of about 2,150 lines with about 90 state hooks. | Med | Low | - | High | Measured; 1,906 lines on 2026-10-18 after the question-reports, content-admin and import/export moves |
| 12 | `MT-02` | Content is held in mutable module variables (`WORDS`, `GRAMMAR`, `LEVELS`...) replaced at run time. | Low | - | - | High | By reading |
| 13 | `MT-03` | The old round engine in WordHunter (the `playing` screen, about 260 lines of screen code, and the answer handlers only it uses, such as `registerResult` and `handleSelect`) is unreachable and holds a second copy of grading and mastery rules. The exact set of dead functions needs a check; some neighbours (final report, speed results) are still used. | Med | - | - | High | By reading (static) |
| 14 | `MT-04` | The session lifecycle and the save effects in WordHunter have no unit tests; sign-in and sign-up have no automated test; no browser spec runs against Supabase. | Med | Med | - | High | By reading |
| 15 | `DP-06` | `sense_progress` and `rule_progress` exist but are not used; two progress models are implied. | - | Low | - | Med | Confirmed (no readers or writers in the repo) |
| 16 | `PE-03` | Maintenance mode and the announcement are enforced only in the browser; the README says settings are "enforced in the database". | - | - | Low | - | By reading |
| 17 | `DP-07` | [word-hunter-backup.json](../../word-hunter-backup.json) holds content plus one account's progress, one report and session logs, and is used as a test fixture and as the first-run restore file. | - | Low | Low | Low | Measured (keys only) |
| 18 | `MT-05` | Library, Live, friends and admin each have a local and an online implementation. | - | - | - | Low | Accepted cost; guarded by contract tests for the library |
| 19 | `LC-03` | Score and streaks change on every answer, mastery only when the session is finished. A player who stops on the summary screen sees the points but not the mastery change until they press a button. | Low | - | - | - | By reading (design note) |
| 20 | `MT-06` | Documentation drift (for example the maintenance claim above). | - | - | - | Low | By reading |

### Notes behind the top items

**`DP-01` (confirmed).** On a throwaway database with synthetic users, the admin renames a word through the normal publish function. The player's mastery follows the new name. The player's library list drops from one word to none, because the old dictionary row is flagged deleted and the library entry still points at it, and the new row is not in their library. On Home, a player sees only words in their library, so the word disappears for them. Words renamed before today are probably affected already (**Suspected**; count them with a read-only query on a copy before doing anything).

**`LC-01`.** Word stages come from the session-evidence rule ([V2.stage](../../src/engine/v2.js)): enough answers, accuracy, two modes, one typed answer, and three independent sessions. The function that Home, badges, stats and the level counts call ([getMasteryStage](../../src/engine/data.js)) hands words with session evidence to that rule but uses a shorter rule (5 answers, 80%) for grammar, challenge and pun items. So a grammar rule can reach "Mastered" on weaker evidence than a word.

**`PE-01` and `PE-02`.** Together they mean the leaderboard can be set to any number by the player. Only that player's own data and rank are affected; no other player's data or any shared content is reachable. The probes ran on a local Postgres with a stub for Supabase's roles; confirm on the real project's grants before deciding the fix.

## Plan

Each phase is small enough to review on its own and ends with an acceptance test. Phases can be reordered, but 0 comes first and 4 should not start before 0 is done. **Database changes (migrations) and production data repairs need the owner's explicit approval each time**; for every phase below that touches them, the first step is to test on a copy.

### Phase 0: safety net (no behaviour change)

Goal: be able to change code with confidence.

- Add a SQL test for the rename scenario in `DP-01`, written to describe the **wanted** behaviour and marked as a known failure until Phase 1.
- Add characterization tests for the session lifecycle: one answer updates the counters once; finishing applies mastery evidence once; reopening a finished session does nothing; leaving mid-session keeps the session. Run them through the real handlers or through a thin extraction that does not change behaviour.
- Add a unit test table for the mastery stage of word and grammar records (pins `LC-01` as it is today).
- Add a test for sign-in and sign-up error messages with a fake client.

Acceptance:

- CI is green with the new tests; no source file under `src/` or `api/` changes except for a test-only extraction.
- The known-failure test is listed in the PR and fails for the reason in `DP-01`.
- A short list of behaviours that are now pinned is added to the relevant module page.

### Phase 1: stop losing data

Targets: `DP-01`, `DP-03`, and the check for old renames.

- Make a rename carry library entries, view membership and links to the renamed row (or keep the old row in step), using the alias table that already records renames.
- Make `dictionary_sync` part of the same publish step, or report its failure to the admin and retry it.
- Prepare, but do not run on production, a repair for words renamed in the past. Run its read-only counting version first.

Acceptance:

- The Phase 0 SQL test now passes: after a rename the player's library and the view still list the word, and mastery is under the new key.
- All existing SQL tests and `library-contract` tests still pass on a fresh database.
- A content save whose sync fails shows a visible message to the admin (test with a forced failure).
- The repair, when approved, is idempotent and its dry run reports the number of rows it would change; a second run changes nothing.

Rollback: migrations are additive; the repair writes a log of what it changed.

### Phase 2: make "mastered" mean one thing

Targets: `LC-01`, `LC-02`, and a decision on `LC-03`.

- One stage function for every kind of item, used by Home, badges, stats, profile numbers and the admin. Decide the grammar rule with the owner (what evidence should grammar need?).
- A rule for AI-written sentences: for example, do not add a sentence to a pool unless it passed the check, or mark it so the admin can review. Decide with the owner.
- Write the decision for `LC-03` in the practice module page (keep or change).

Acceptance:

- The table test from Phase 0 is updated to the agreed rules and passes.
- A before and after comparison on a synthetic backup lists exactly which items change stage; the owner accepts the list.
- Existing players' saved data needs no rewrite, or a migration is written, tested and approved.
- With the AI check forced to fail, no unchecked sentence reaches a player's pool (or it is marked, depending on the decision).

### Phase 3: tighten permissions

Targets: `PE-01`, `PE-02`, `PE-04`, optionally `PE-03`.

- Bound what one save can add to the score, or compute the score on the server from the saved rounds; apply the same idea to the mastered count.
- Remove direct write access to `progress` and `mastery` for players so all writes go through `save_progress_v2`.
- Decide what to do about free-text AI prompts (accept the risk with the daily quota, or restrict).
- Optional: let the server refuse player calls while maintenance mode is on.

Acceptance:

- New SQL tests: the cheating cases from the probes are refused or clamped; normal saves, restores (`replace`) and the two-device merge tests still pass.
- Re-run the probes on the real project (or its branch) before and after.
- The browser specs and `repo` tests pass unchanged.

### Phase 4: make the code easy to change

Targets: `MT-01`, `MT-02`, `MT-03`, `MT-04`, then the cycles in [module-map.md](module-map.md#1-observed-dependencies-today).

Steps, each its own change:

1. Delete the unreachable round engine (`MT-03`).
2. Extract the session lifecycle into `practice`.
3. Split `content` and `progress` out of `repo.js` behind the same interface.
4. Break the `live`/`social` and `engine`/`lib` cycles.
5. Replace the content globals with an object passed down.

Acceptance (for every step):

- No behaviour change: unit tests, browser specs and the SQL tests pass; a recorded play-through (start a round, answer, finish, reload) gives the same saved progress before and after.
- After step 2, WordHunter.jsx is under about 1,000 lines; after step 5, under about 600.
- An import-direction lint rule (or a test) enforces the rules in the module map and passes.

### Phase 5: decide the progress model

Targets: `DP-06`, `DP-07`, and the long-term shape described in ADR [0004](../adr/0004-text-keys-for-words-and-progress.md).

- Decide whether progress keeps text keys or moves to ids (`sense_progress`). Record it as an ADR.
- If it moves: write progress to both for a period, compare, then switch reads; keep importing old backups.
- If it stays: drop the unused tables in a migration.
- Replace the root backup fixture with a synthetic one.

Acceptance:

- The ADR is accepted by the owner.
- Dual-write period: a comparison query shows zero differences for a full week of synthetic and real-usage tests before reads switch.
- Old backup files still import and give the same result as before (test with the current files).
- The test fixture contains no real account data.

## Standing rules while doing this

- Work on a branch; no merge, deploy or production database change without explicit approval.
- Use synthetic data in tests and in this documentation.
- Keep the saved progress format, word keys, meanings, rules and the import file formats compatible unless an ADR and a migration say otherwise.
- Update the docs in the same change as the behaviour, per the [documentation rules](../README.md#documentation-rules).
