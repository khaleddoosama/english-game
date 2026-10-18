# ADR 0008: Mastery changes from per-session evidence

- Status: Accepted. **Implemented** for words; grammar and challenge items use an older rule (`LC-01`).
- Modules: [learning-engine](../modules/learning-engine/README.md), [practice](../modules/practice/README.md)

## Context

If every correct answer raised a word's level, repeating one question or one session would inflate it. Mastery should reflect that the player can use the word in different ways on different occasions.

## Decision

When a session is finished, `V2.sessionEvidence` adds at most one scored result per word per session. A word is "Mastered" only with enough scored rounds and accuracy, correct answers in at least two modes, a correct typed answer, and independent success in at least three sessions. A hint on any answer makes the round a miss for that word. Reported or unverified answers, failed AI checks, and Speed Round answers add nothing. A session id is applied once. A mastered word that keeps failing can fall back (regression strikes).

## Why

From the comment above the session handlers in [WordHunter.jsx](../../src/app/WordHunter.jsx) and from [v2.js](../../src/engine/v2.js): repeated questions in one session must not inflate a stage; partly finished sessions must still count for score, streaks and confusion learning.

## Alternatives (reconstructed)

- Update mastery on every answer (the older engine did this): simpler, easy to inflate.
- Spaced-repetition scheduling only: strong for retention, but a bigger change to how rounds are built.

## Consequences

- Score and streaks change on each answer, mastery at the end of a round (`LC-03`).
- Two stage functions exist; Home, badges and stats call the one in [data.js](../../src/engine/data.js), which uses the session rule only for words that carry session evidence (`LC-01`).
- A record carries lists of applied sessions (bounded to 50) so a round is never counted twice after a merge.
