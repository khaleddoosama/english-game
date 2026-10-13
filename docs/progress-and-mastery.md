# Progress, mastery and saving

## 1. A round from start to save

```
startPractice(category, narrow)            WordHunter.jsx
  → V2.practice(content, mastery, category, rng, quarantine, opts)   builds { queue, introductions, reserves }
  → SessionView                             shows introductions (new words), then questions one by one
      each answer → V2.grade(question, value)   → { correct, spelling, unverified }
                  → recordSessionResult(q, result, session)   (immediately, per answer)
  → completeSession(session)                at the end
      → V2.sessionEvidence(mastery, session) → new mastery
      → sessionLogs, dailyHistory, levelStats, solvedStories
  → effect on state change → repo.saveProgress(...)   (diff-based, see §6)
```

### Per answer (`recordSessionResult`)
- Ignored when the answer is `reported`, `unverified` (AI could not judge), `aiFailed`, or the question has `noTelemetry`.
- Each answer is recorded **once** (`recordedSessionAnswersRef`, key = session id + index).
- `independentCorrect = correct && !assisted`.
- Daily goal counter (`dailyProgress`), `attempted +1`, answer `streak` (+1 if independent-correct else 0), `score +10` if independent-correct. A toast appears when `dailyGoal` is reached (default 20).
- The used pool item gets `attempts +1`, `correctCount +1` if independent-correct; at 2 → locked for 7 days; maybe AI generation is triggered (see [ai-usage.md](ai-usage.md) §3).
- A wrong choice of another *word* is stored as a confusion (`trackConfusion`).
- The sentences shown are stored in `seenSentences` (not for the speed round).

### At the end (`completeSession`)
- Guard: `completedSessions` (last 500 ids) so a round is applied once.
- Only a **fully answered** round writes a `sessionLogs` entry (last 50) and `dailyHistory` (120 days).
- `V2.sessionEvidence` updates mastery (see §3).
- Practice round named like a category: `levelStats[cat-…]` gets attempts, best accuracy, stars (≥ 95 → 3, ≥ 85 → 2, ≥ 70 → 1); accuracy ≥ 70 → the level is "cleared".
- Story round: keeps the player's **best** `{correct,total}` per story.
- `finalRecall` (Final Case): shows the summary screen.
- Speed round: points = 10 per correct + 2 × combo (combo capped at 5); updates `bestSpeedScore` and `bestSpeedCombo`.

## 2. Picking the words (`V2.practice`)

1. Source = words of the category (or unit / sub-category / course level, `opts`).
2. **New words:** words with no `introducedAt`/answers, sorted by `difficultyRank` (A1 < A2 < … and course levels in order), at most `newWordsPerRound` (default 3). They get an introduction card first; the last introduced word is never the first test.
3. **Known words:** no spaced repetition. Order = missed last time first, then **least recently reviewed** first, so a correct word goes to the back of the line.
4. The rest of the round is filled up to `questionsPerRound` (default 12). A small category ends early instead of repeating.
5. One combo (words all known) and one authored impostor challenge (target Learned+) per round at most, rotated by last seen.
6. Grammar: 1–2 rules of the same lessons per round (1 if the round has fewer than 10 questions), missed first then least recently seen. A lesson with rules but no words becomes a grammar-only round.
7. At most one grammar question per four word questions; they are spread (never first).
8. **Reinforcement:** at the end of a round up to 2 reserve questions about words answered wrong are appended (`V2.reinforcement`).

Weak Evidence (`startWeakReview`) uses `getWeakWordCandidates` (priority points: last wrong 7, accuracy < 70% after ≥3 tries 6, weak mode 5, spelling 4, missing production 4, confusion up to 7, failed sentence 5) and `pickWeakMode`.

## 3. Mastery stages

Stage of a **word** (`V2.stage`, used when `evidenceV2`):

| Stage | Rule |
|---|---|
| New | no correct round yet |
| Familiar | `correct ≥ 1` |
| Learned | `correct ≥ 2` and ≥ 2 different modes answered correctly |
| Mastered | `everMastered` (and `regressionStrikes < 3`), **or** `total ≥ 5`, accuracy ≥ 80 %, ≥ 2 modes, `productionCorrect ≥ 1`, and ≥ 3 `independentSessions` |

Grammar / combo / challenge items (no V2 evidence): Mastered at `total ≥ 5` and accuracy ≥ 80 %; Learned at `total ≥ 2` and ≥ 70 %.

`sessionEvidence` (per key, per round):
- The key list of a question: `progressKeys` or `progressKey` or its `targets`. All answers in the round for one key are grouped: the round is **ok** only if every answer was correct and none assisted.
- `correct +1` (if ok), `total +1`, per-mode counters, `recentResults` (last 8), `lastResult`.
- Typed correct answer (not a transform) = **recall** → `productionCorrect +1`.
- `reviewStep`: +1 when ok, reset to 0 on failure; capped at **2** (`PRODUCTION_GATE_STEP`) until one typed success, then 4. At the gate the word only gets typing questions.
- `independentSessions` (last 20) and `appliedSessions` (last 50) make a round idempotent across devices.
- Once mastered: `everMastered = true`; each later failed round adds a strike, each ok round removes one; 3 strikes lose Mastered.
- Not counted: reported answers, unverified, `aiFailed`, `noMastery` questions (self-check sentences, "unavailable" questions), the speed round, and words in `session.unfairTargets` (words introduced inside a story round).

Adaptive difficulty (older builders) is `getAdaptiveDifficulty`: stage base 1–4, −1 for recent misses or <50 % accuracy in that mode, +1 for 3 correct in a row or ≥ 85 % (≥ 2 tries), typing capped at 3 if spelling misses; gap up to 5.

## 4. Grading (`V2.grade`)

- Compare after trimming, lowercasing and fixing spaces before punctuation; the bare word (without a trailing bracket) is also accepted.
- Multi answers: same count and every expected answer present.
- Typed, not a model-only question, not another word in the game, and ≥ 3 letters: **edit distance ≤ 1** → `spelling: true` (not correct, but counted as a spelling miss, which raises typing weight later).
- `modelOnly` questions (free sentences, grammar fix, phrasal transform) → `unverified` locally → judged by AI (`evaluateFreeForm`…). If the AI fails the answer is `aiFailed` and not counted.

## 5. Settings that change the round

`questionsPerRound`, `newWordsPerRound`, `weakReviewSize`, `enablePairModes` (turns Two People / Select Two off through `RUNTIME_DISABLED_MODES`), `dailyGoal`, `speedSeconds`. Admin defaults for new players: `newPlayerDefaults` in app settings.

## 6. Saving and merging (`src/lib/repo.js`, `progressMerge.js`)

- **Diff-based:** only changed sections (`stableJson` compare) and changed mastery rows go over the network. Saves coalesce: while one is in flight only the newest state waits.
- **Local first:** every state is written to an IndexedDB snapshot (`progress:<userId>`, `dirty: true`) before sending; after success it is marked clean. Closing the app mid-save loses nothing. A failed save retries every 15 s and when the browser goes online. Header status: saving / saved / offline / error.
- **Revisions:** each section has `rev`. A save sends the revision it last saw. If another device wrote first, the server writes nothing and returns its copy; the app does a **three-way merge** (base = last known server copy, local, server) and retries up to 4 times.
- **Merge rules:** a field only one side changed takes that side; if both changed: counters add up (`score`, `attempted`, level attempts, confusion counts), bests take the max, lists join by id (`sessionLogs`, `reports`, `solvedStories`), `dailyHistory` adds per day, `pools` merge per key, `seenSentences` take the later time, mastery takes the record with more answers and unions `appliedSessions`/`independentSessions`.
- **Foreground refresh:** `refreshProgress` checks revisions when the app returns to the front and merges another device's play.
- **Backups** (`replace: true`) overwrite instead of merging; the leaderboard score is set without counting it as this week's points.
- **Leaderboard numbers** are computed on the server in `save_progress_v2` from the saved progress (a player cannot write them); only `mastered_count` and `week_start` come from the app (`profileSummary`).

## 7. Renames and deletes

Renaming a word or a category in Admin sends `p_renames` with the content save. The database moves mastery, pools, confusions, reports' target words, level stats and cleared levels in the same transaction (a player with both names keeps the record with more answers) and remembers the alias. Deleting content leaves players' mastery rows (harmless; they are ignored if the word is gone).
