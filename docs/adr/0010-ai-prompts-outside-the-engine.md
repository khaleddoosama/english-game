# ADR 0010: The AI prompts live with the AI client, outside the engine

- Status: Accepted. **Implemented** (2026-10-21).
- Modules: [learning-engine](../modules/learning-engine/README.md), [ai-media](../modules/ai-media/README.md),
  [progress](../modules/progress/README.md)

## Context

`engine` and `lib` imported each other, the last loop between modules (`tests/architecture.test.js`):

- `engine/ai.js` (the AI prompts and the checks of what comes back) called the AI client: `callAiText` in
  `lib/ai.js` and the job registry in `lib/aiOperations.js`. These were the only imports from the engine to `lib`.
- `lib` used the engine's rules in three places: `lib/repo/progressShape.js` counts the mastered words for the
  leaderboard with `V2.stage` and `isWordKey`, and `lib/progressMerge.js` reads saved confusion entries with
  `confusionCount`.

The [module map](../architecture/module-map.md) already put the prompts in the `ai-media` module, not in the pure
learning engine.

## Decision

`src/engine/ai.js` moves unchanged to `src/lib/aiPrompts.js`, next to the AI client. Only its import paths and the
import paths of its users change. The engine now imports nothing from `lib`; `lib` keeps using the engine's rules.

## Why

- The engine is the pure part; the prompts call the network, so they were the edge in the wrong direction.
- One file moves and nothing else changes. The production build is byte for byte the same as before (all 20
  JavaScript chunks, checked on 2026-10-21), so no behaviour can change.
- The repo is not touched, so the mastered count and the leaderboard numbers come from the same code as before.

## Alternatives

- **Cut the other edge: `lib` stops importing the engine.** Move `isWordKey` and `confusionCount` into `lib`, and
  pass the mastery-stage function into the repo. Every place that makes a repo would have to pass it: the app
  (`src/app/App.jsx`, the only one in the game) and 54 calls in the unit, database and real-stack tests and the
  `saveclose` browser spec. A call that forgot it would save a wrong `mastered_count`, which is what the
  leaderboard shows. More change, more risk, for the same result.
- **Pass the AI client into the prompts.** The prompts wrap their functions in the job registry when the file
  loads, so that would change how every AI function is made.

## Consequences

- `features/reports` and `features/data` now depend on `lib` (they call the prompts); a guard keeps that to
  `lib/aiPrompts` alone, so their boundary is as narrow as when they imported `engine/ai`.
- Guards: no loop between modules, and the engine imports no module at all (`tests/architecture.test.js`).
- Docs that named `engine/ai.js` point to `lib/aiPrompts.js`. Older work records keep the old name as history.
