# Word Hunter documentation

Working documentation for the Word Hunter code base. The top-level [README](../README.md) explains what the game is and how to run, test and deploy it. These pages explain how the code is organised and what to watch out for when changing it.

## Index

### Architecture

| Page | What it is for |
| --- | --- |
| [architecture/current-state.md](architecture/current-state.md) | Entry points, screens, state, API routes, data layer, main user journeys, source of truth per entity, what was verified |
| [architecture/module-map.md](architecture/module-map.md) | Proposed module boundaries and dependency rules |
| [architecture/roadmap.md](architecture/roadmap.md) | Ranked problem register and a phased plan with acceptance criteria |
| [architecture/modules.md](architecture/modules.md) | The module pattern (layers, one front door, boundary tests), proven on the library, and the plan for the rest |
| [architecture/repo.md](architecture/repo.md) | The repo layer (`src/lib/repo.js` and `src/lib/repo/`): its parts and their state |
| [adr/](adr/README.md) | Architecture decision records: what was decided, why, alternatives |
| [ai-usage-inventory.md](ai-usage-inventory.md) | Where the app uses AI (written earlier, in Arabic) |

### Tests, migrations and work records

| Page | What it is for |
| --- | --- |
| [integration-tests.md](integration-tests.md) | Database integration tests and the real-stack tests: what they need, how to run them, what they do not prove |
| [library-unit-test-matrix.md](library-unit-test-matrix.md) | Library and view-round rules, each with the test that checks it |
| [migrations/review-0037-0042.md](migrations/review-0037-0042.md) | Review of migrations 0037-0042: order, compatibility, rollback, what was not verified |
| [migrations/diagnosis-renamed-words.md](migrations/diagnosis-renamed-words.md) | Library entries left behind by renames made before 0037: diagnosis and repair plan (not run) |
| [work-tracking/](work-tracking) | What was done, checked and left, per piece of work; handover notes |

### Modules

One folder per module under [modules](modules). Each page has the same sections: purpose and scope, public operations, files and database objects, rules and permissions, data flow, failure and offline behaviour, tests and gaps, an example journey, and a status section.

| Module | Summary |
| --- | --- |
| [app-shell](modules/app-shell/README.md) | Start-up, routing, layout, player preferences, wiring |
| [accounts](modules/accounts/README.md) | Sign-in, sign-up, roles, profile |
| [content](modules/content/README.md) | The shared course ("Dictionary"): loading, caching, saving, import and export, renames (guides: [dictionary rules](modules/content/dictionary-rules.md), [loading and saving](modules/content/content-sync.md), [the game's copy](modules/content/content-catalog.md)) |
| [learning-engine](modules/learning-engine/README.md) | Pure rules: questions, grading, mastery, session evidence; guide to [practice question selection](modules/learning-engine/practice-selection.md) |
| [practice](modules/practice/README.md) | Home, sessions, results, stories, speed, stats, question reports (guide: [question-reports](modules/practice/question-reports.md)) |
| [progress](modules/progress/README.md) | A player's saved state, offline snapshot, merge, leaderboard numbers |
| [library](modules/library/README.md) | My Library: personal library, views, sharing, links, catalog |
| [live](modules/live/README.md) | Live Challenge |
| [social](modules/social/README.md) | Friends, leaderboard, profile, counts |
| [ai-media](modules/ai-media/README.md) | Gemini calls, quota gate, pronunciation, pictures (guides: [Ask AI](modules/ai-media/ask-ai.md), [story generation](modules/ai-media/story-generation.md), [new sentences and variants](modules/ai-media/pool-generation.md)) |
| [admin](modules/admin/README.md) | Analytics, players, content tools, reports, audit, settings (guides: [content admin](modules/admin/content-admin.md), [import and export](modules/admin/import-export.md)) |

## Status words

Every module page separates three kinds of statements. Do not mix them.

| Word | Meaning |
| --- | --- |
| **Implemented** | It exists in the code today and was checked by reading it, by a test, or by a run. The page says which. |
| **Planned** | A proposal that is not in the code. It is never described as if it were done. The source is [roadmap.md](architecture/roadmap.md) or an accepted ADR. |
| **Known Issue** | A confirmed or suspected problem, with an ID from the [problem register](architecture/roadmap.md#problem-register) and the evidence level (Confirmed, By reading, Suspected). |

The architecture pages also use **Current**, **Confirmed defect**, **Defect (by reading)**, **Assumption** and **Not verified** (see the top of [current-state.md](architecture/current-state.md)).

## Documentation rules

The goal is documentation that stays true, not documentation of everything.

**Update the docs in the same change when you:**

1. change observable behaviour (what a player, the admin or another module sees or can do);
2. change a public contract: a database function's arguments or result, a table's meaning, an API route, the saved progress format, an import or export file format, a module's interface listed in [module-map.md](architecture/module-map.md#4-public-contracts-to-keep-stable), or a limit or rule shown in the UI;
3. add, remove or move a module, a screen or a route;
4. fix or discover a problem listed in the register, or change its evidence or severity;
5. make a decision that is hard to reverse or affects more than one module (add or supersede an ADR).

**What to update:** the module page(s) that own the change; the register and plan if a problem or phase is affected; [current-state.md](architecture/current-state.md) only when a journey, route, table or source of truth changes; the top-level README if setup, environment variables or user-facing features change.

**Not required:**

- A comment or a doc entry for every function. Document purposes, contracts, rules and flows.
- Doc updates for refactors that keep behaviour and contracts, bug fixes that restore documented behaviour, styling, copy edits, or test-only changes.
- Copying code into the docs. Link to the file instead; describe what it does and why.

**Style:**

- Write in English. Keep sentences short and concrete.
- Link to files with relative paths. Name functions and tables; do not paste their bodies.
- Mark each statement as Implemented, Planned or Known Issue. Never write a proposal as if it were built.
- Use synthetic data only. Do not put real usernames, passwords, keys, tokens or player progress in the docs.
- Name tests by what they check. Counts of tests or coverage are not evidence of quality.

**Review check (pull requests):** if the change touches a contract above, the description says which doc was updated, or why none was needed.

**Keeping it honest:** the verification table in [current-state.md](architecture/current-state.md#9-verification-performed-for-this-document) records the date and result of the checks behind the architecture pages. Re-run the checks and update the table when you change those pages materially.
