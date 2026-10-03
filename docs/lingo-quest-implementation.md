# Lingo Quest learner interface

Branch: `feat/lingo-quest-responsive`, based on master `18b36ba`. Review: https://github.com/khaleddoosama/english-game/pull/18.

## Learning flow

Course level → ordered units → training → unit test → comprehensive final. Units come from actual content; their count is variable, shared words can belong to multiple units, and grammar-only units are included. Every unit item needs a recorded practice attempt before its test opens. Introduction cards alone do not count.

Unit tests and level finals require at least 70% independent correct answers. Assisted, reported, skipped and unverified responses do not earn pass credit; percentages do not round up for unlocking. Unit tests cover all unit items. Finals sample three words from each unit and include all its rules, prioritising production/correction. Missing safe questions block an exam instead of silently omitting a unit. A unit pass opens the next unit; a final pass opens the next level. Failed retries preserve prior passes, and completion is idempotent.

Listening, browser speech recognition, sentence token building and matching use the same Supabase words/examples. Speech and token building are guided practice, with no independent mastery credit. Speech checks the transcript, not pronunciation quality. Microphone denial has a typed fallback. Browser voice availability depends on the device.

Training mistakes use hearts, with five maximum and one refill every 30 minutes. A five-question recovery round earns a heart and preserves interrupted training. Review and exams do not consume hearts; players can disable training hearts in Settings. Spaced review self-ratings schedule another card review but do not increase mastery or XP.

## Design coverage

The learner surfaces from the supplied 48-page design are implemented or connected to the existing engine. Administration is deferred.

| Design pages | Implementation |
| --- | --- |
| 1, 6, 19 | Journey path, responsive desktop sidebar, unit cards and unlock states |
| 2, 18 | Sentence token building, duplicate tokens and typed alternative |
| 3, 4 | Answer feedback, session results, XP, accuracy, time and answer review |
| 5, 15, 20–23 | Unit guide, introduction cards, searchable word bank, details and focused review |
| 7–9, 47 | Welcome, username sign-in/sign-up and study-goal onboarding |
| 10–12 | Listening, matching and speech transcript practice |
| 13, 14 | Hearts/recovery and scheduled flashcard review |
| 16, 17, 46, 48 | Weekly leaderboard, profile, achievement progress and account settings |
| 24–29 | Existing picture, typing, two-answer, free-form, correction and Grammar Court engines within the learner theme |
| 30–32 | Supabase story library, paged reader, text size, word lookup and story check |
| 33, 34 | Existing final-case flow in free practice; curriculum finals remain a separate gated flow |
| 35–38 | Existing create/invite/lobby/play/results Live flow; actual course levels and mobile layout |
| 39–43 | Existing speed rounds, dashboard, AI exploration and question reporting |
| 44, 45 | Theme/voice/accessibility settings and player progress/CSV export |

Backend-compatible adaptations: authentication remains username/password; account display names are stored in learner progress, password changes use existing Supabase Auth. OAuth, email reset, self-deletion and fictional league promotions are not represented as functional controls. Starting focus is a preference rather than a fabricated placement test or level unlock. Live retains its existing limit of ten participants. AI actions retain their existing endpoints and honest failure states.

## Authoritative content

Supabase is the sole application curriculum source. Uploaded exports and repository backups are not used as curriculum. Missing Supabase configuration shows setup instructions instead of starting a local repository. Offline cache is a copy of previously fetched Supabase content.

The `word-hunter` project (`sbekepibxivyysgealpr`) was queried read-only on 2026-10-03. The latest snapshot contained 257 words, nine grammar rules and one story. Its actual labels include A1, A1.3, A2, A2.2, A2.3, B1, B1.1, B2 and C1, plus unassigned items. Course metadata is read in order: `courseLevel`, `gatewayLevel`, Gateway level tag, existing `level`. Existing labels are preserved; numbered placement is not invented from old exports. Source unit array order is retained. No production content or schema was changed.

Journey and learner preferences are additive fields in existing progress persistence. Hearts, goals, display name, review schedules and paused sessions are saved with that progress. Existing mastery stages and scoring remain authoritative.

## Verification and limits

`npm test`: 159 tests passed. `npm run build` and `git diff --check` passed. Tests cover exact 70% thresholds, content grouping, grammar coverage, gating, retries, idempotency, training rotation, repository round-trip, heart timing, review scheduling, interactive question generation and story category changes.

Browser verification uses a read-only snapshot of current Supabase curriculum with all authentication/database/AI requests intercepted. Its synthetic test account never reaches production; production writes are zero. Thirteen learner routes were checked at 320, 390, 768 and 1440 pixels with no document overflow. Unit training, test, comprehensive final, preference reload, word details, scheduled review, all four interactive practice modes, theme persistence, heart depletion/recovery and story reader/check were exercised. Evidence screenshots show that real curriculum inside the isolated replay, not a production authenticated session.

Actual authenticated production verification remains blocked: automatic approval review rejected credentials from older conversation context because a currently approved test account is required. Microphone hardware recognition, live multiplayer transport and successful AI model responses require their respective real integrations for final end-to-end verification. Existing automated coverage and isolated fallback paths do not substitute for those checks. No merge or production deployment has been performed.
