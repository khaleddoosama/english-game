# Architecture decision records

Short records of the decisions that shape Word Hunter. Each one says what was decided, why, what else could have been done, and what follows from it.

The reasons come from comments in the code, the README and the migrations. The repository does not record which alternatives were weighed at the time, so the "Alternatives" sections are reconstructed during the architecture review and say so. Where a record points at a problem, the ID refers to the [problem register](../architecture/roadmap.md#problem-register).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-username-accounts.md) | Username and password accounts through a placeholder email | Accepted (Implemented) |
| [0002](0002-online-and-local-modes.md) | Two runtime modes behind the same interfaces | Accepted (Implemented) |
| [0003](0003-grading-location.md) | Grade practice in the browser; judge Live on the server | Accepted (Implemented) |
| [0004](0004-text-keys-for-words-and-progress.md) | Words and progress keyed by the word's text, bridged to ids by `legacy_key` | Accepted, under review (see `DP-01`, `DP-06`) |
| [0005](0005-revisioned-progress-sections.md) | Progress saved as revisioned sections and merged on conflict | Accepted (Implemented) |
| [0006](0006-ai-through-server-functions.md) | AI only through server functions with a task list and a database gate | Accepted (Implemented) |
| [0007](0007-library-as-new-model.md) | Library and views as a new data model beside the legacy content | Accepted, migration unfinished |
| [0008](0008-session-evidence-mastery.md) | Mastery changes from per-session evidence | Accepted (Implemented), rules differ for grammar (`LC-01`) |
| [0009](0009-history-api-router.md) | A small History API router instead of a routing library | Accepted (Implemented) |
| [0010](0010-ai-prompts-outside-the-engine.md) | The AI prompts live with the AI client, outside the engine (ends the `engine` <-> `lib` loop) | Accepted (Implemented) |

## How to add or change a record

- Add a record when a decision is hard to reverse, affects more than one module, or changes a public contract (saved data format, database function shape, API route).
- Use the next number and the same headings: Status, Context, Decision, Why, Alternatives, Consequences.
- Do not edit an accepted record to change history. Write a new record that supersedes it and change the old record's status line to point to it.
