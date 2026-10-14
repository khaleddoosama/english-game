# ADR 0003: Grade practice in the browser; judge Live on the server

- Status: Accepted. **Implemented.**
- Modules: [practice](../modules/practice/README.md), [learning-engine](../modules/learning-engine/README.md), [live](../modules/live/README.md)

## Context

Practice is a private learning tool where cheating only hurts the player, and the questions work offline. Live Challenge is a competition between players, where one player's browser must not see another's answers or decide the result.

## Decision

Practice answers are graded in the browser (`V2.grade`, with an AI second opinion for typed alternatives and free writing). Live answers are judged and timed by the database: the answer keys are stored apart from the questions, a player sees one question at a time, and `live_answer` decides correctness and time.

## Why

From [liveRules.js](../../src/features/live/liveRules.js) and the Live migrations: answers must not reach a player's device before they answer; time is measured from the server's clock with a fixed network allowance; a retried answer must return the same result.

## Alternatives (reconstructed)

- Grade practice on the server as well: stronger integrity, but adds latency, needs a connection for every answer, and the leaderboard is the only place where integrity matters for practice.
- Grade Live in the browser: simpler, but any player could read the key or change the result.

## Consequences

- Practice scores are not trustworthy as a competition: the leaderboard accepts the numbers the browser sends (`PE-01`).
- The Live host's browser writes the questions and the key. The server checks their shape, not their truth.
