# ADR 0005: Progress saved as revisioned sections and merged on conflict

- Status: Accepted. **Implemented.**
- Modules: [progress](../modules/progress/README.md)

## Context

A player may use a phone and a laptop, or two tabs. Progress is large (history, pools, many mastery rows) and changes after every answer. Overwriting the whole thing loses play from the other device and wastes bandwidth.

## Decision

Progress is split into sections (core, session, pools, seen, confusions, history, levels, reports) plus one row per mastered item. A save sends only what changed, with the revision it last saw for each section. If another device wrote first, the server returns its copy and the browser merges by meaning (counters add, bests take the larger, lists join by id) and tries again. Each state is written to an IndexedDB snapshot before it is sent, so a closed tab or a lost connection loses nothing.

## Why

From the header of [repo.js](../../src/lib/repo.js) and [progressMerge.js](../../src/lib/progressMerge.js): two devices must both count; the app must work offline and catch up; saves must stay small.

## Alternatives (reconstructed)

- Last write wins: simplest, loses play from the other device.
- One row per answer (event log): exact, but heavy and a larger change to the data model.
- Server-side merge: keeps rules in one place but needs the merge logic in SQL.

## Consequences

- The merge rules live in the browser. They are tested ([review-audit.test.js](../../tests/review-audit.test.js), [repo.test.js](../../tests/repo.test.js), SQL `progress_merge.sql`).
- Mastery rows have no revision. The server keeps the record with more answers (`DP-04`).
- The server accepts the leaderboard numbers from the payload (`PE-01`).
