# Lingo Quest implementation

Branch: `feat/lingo-quest-responsive`, based on master `18b36ba`.

## Implemented first slice

- Responsive purple/gold user shell, desktop side navigation and mobile bottom navigation. Admin palette and component implementation retained.
- Course level -> ordered units -> training -> unit test -> level final challenge.
- Units come from content rather than a fixed six-slot template; shared words can belong to multiple units, grammar-only units are included.
- Full unit content must have recorded training attempts before its test is available. Introduction cards alone do not count.
- Unit exam and level final require at least 70% independent correct answers. No rounding-up, empty-test passes, assisted credit or reported-question credit.
- All unit rules and words are tested by the unit exam. Final challenges sample three words from each unit and include all its rules, prioritising production and correction. Missing valid questions block the exam instead of omitting a unit.
- Next unit unlocks on unit pass, next course level only on final pass. Completed passes persist through failed retries and duplicate completion calls are idempotent.
- Course progress is an additive `journey` field in the existing progress persistence and backup mechanism. No production schema changes or deployed changes.
- Review/word bank, search, filters, word details, and existing weak-review engine.
- Existing free-practice stays under `/practice`. Journey detail selection lives in `/?level=...&unit=...`, review at `/review`.

## Content mapping

Course placement reads `courseLevel`, then `gatewayLevel`, then `English::Gateway::Level-*` in tags, then existing `level`. CEFR levels must not be substituted for a course number when both differ: supply `courseLevel` on words AND rules. Units preserve source array order; the Anki tag sort order is not an authoritative curriculum order. An explicit curriculum ordering model remains to be agreed for the real course.

Supabase is the sole authoritative source for game content. Repository backups, uploaded exports and browser-local content are not curriculum sources. The app stops at a connection setup message when Supabase configuration is missing instead of opening the local repository. The existing offline cache is a copy of Supabase content; test fixtures remain isolated from application content.

Read-only verification on 2026-10-03 matched `.env.example` to the `word-hunter` project (`sbekepibxivyysgealpr`). Active content contains 137 words, 5 grammar rules and 1 story. Of these, 136 words and all 5 rules have `units`. None has `courseLevel`, `gatewayLevel` or `tags`; existing `level` values include A1, A2, B1, B2 and C1. These are the current server labels, not evidence of numbered Gateway placement. Numbered course placement and curriculum order therefore remain unresolved; do not infer them from a backup or uploaded export. No production content was changed.

## Remaining screens and release checks

This is the initial working slice, not completion of all 48 design pages. Auth/onboarding, advanced question interactions (listening, speech, translation building), story reader presentation, league/profile/settings/data-transfer refinements, and final visual parity remain. Existing screens retain their existing functionality with shared user theme styling.

Browser verification passed at widths 320, 390, 768 and 1440 with no document horizontal overflow. The browser run used isolated test fixtures to complete training, both unit tests and the course final, save completion, reload and verify persisted completion, then check word-bank search and details; no page errors were recorded. Screenshots are in `docs/screenshots/`; they do not represent the production curriculum. Live Supabase content was subsequently inspected read-only as described above. Authenticated browser verification against Supabase and curriculum mapping must still be completed before merging. Persistence is covered using the existing fake repository tests. Live challenge transport already supports up to ten participants; its existing server/admin limits were retained.

## Validation

`npm run build`, `npm test`, and `git diff --check`. The journey test suite includes course grouping, shared content, grammar coverage, exact pass threshold, failed/assisted answers, level gating, failed retries, idempotency, final content coverage, training rotation and repository round-trip.

## Remote publishing

GitHub integration access was restored on 2026-10-03 and the separate `feat/lingo-quest-responsive` branch was created. Publishing uses the connected GitHub integration because shell Git credentials are unavailable. This branch is for review; production has not been deployed or merged.
