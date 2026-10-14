# My Library: business rules and the unit tests that check them

Scope: the library, personal views, and a practice round started from a view.
Run with `npm test`. Files marked *existing* were there before this review.
Time and randomness are injected in the new tests (`seeded()` in
`tests/libraryFixtures.js`, fake `Date`), and all words are made up.

## Questions and wrong answers

| Rule | Test |
| --- | --- |
| A wrong option is never a synonym of the asked word (declared on either word, plain or with a meaning label) | `library-round-options` › never include a synonym… |
| A word the author kept apart (`excludeFromSameOptionsWith`) never shares options, declared on either side | same |
| Two words with the same meaning (any case or spacing) never share options | same |
| Two meanings of one headword never share options | `senses` (existing) |
| Options are never repeated; the right answer is there once; at least 2 options | `library-round-options` › are never repeated… |
| A choice question does not show its answer in the prompt | `library-round-options` › do not give the answer away |
| A typed question does not show its answer in the prompt (whole word only) | `library-regressions` › a typed question |
| A word with no safe wrong option gets no choice question; the round still builds | `library-round-options` › nobody safe |
| Wrong answers still come from the whole dictionary | `view-scope` (existing) |

## Grading and spelling

| Rule | Test |
| --- | --- |
| Case and spacing are ignored; a missing space is wrong | `library-round-grading` › grading a typed answer |
| The word is accepted with or without its meaning label, but not another label | same |
| One wrong, missing or extra letter is a spelling slip (not correct); two are wrong | same |
| Answers under 3 letters are never a spelling slip; another real word is never a slip | same |
| Empty, blank or missing answers are wrong and do not throw | same |
| A rewrite checked by the game is "unverified", never wrong | same |
| A choice is exact; a multi-pick needs all and only the right ones, in any order | `library-round-grading` › grading a choice |

## Knowledge, review and weak points

| Rule | Test |
| --- | --- |
| A word is known after it is introduced or answered | `library-round-grading` › how well a word is known |
| New → Familiar → Learned → Mastered thresholds, and the regression strikes | same |
| A right answer: +1 correct, +1 step, review time recorded | › what a finished round does to a word |
| One wrong answer in a round resets the step; each kind of question keeps its own count | same |
| A spelling miss and an assisted answer are recorded as such, and never count as knowing | same |
| The step is held at the production gate until a typed answer is right | same |
| The same round is never counted twice | same (and `review-audit`, existing) |
| Reported, unverified, failed, `noMastery`, speed and "unfair" answers change nothing | same |
| Missed words come first, whatever the way they were missed | `library-round-scope` › which known words come back first |
| Otherwise the least recently reviewed come first; never reviewed counts as oldest | same |
| The choice does not depend on the random source | same |
| New words: at most `newWordsPerRound`, easier level first | `library-round-scope` › new words in a view |
| A sentence read in the last 20 hours is held back, and comes back exactly at 20 | `library-round-scope` › sentences read a moment ago |

Note: there are no review dates (`nextReviewAt` is always 0). Words come back by rotation, as the code comment says.

## Which words a round asks about

| Rule | Test |
| --- | --- |
| Only the view's words and rules are asked | `view-scope` (existing) |
| Words in the view but deleted from the dictionary are skipped; all deleted gives an empty round | `library-round-scope` › words that are gone |
| A lesson, group, unit or course level narrows the view (also with each other); no match is an empty round, never the whole dictionary | `library-round-scope` › narrowed by… |
| Courses by level/session without a view | `course-levels` (existing) |
| A pair question needs both words in the view | `library-round-scope` › what else a view round may ask |
| Rules outside the view are never mixed in | same |
| Home shows only what is in the library; counts and plain lists | `home-state`, `view-scope` (existing) |

## Library, views, limits

| Rule | Test |
| --- | --- |
| View names, nesting (4 levels), moves, 200 views, per-player libraries | `library`, `library-tree`, `library-local-views` (existing) |
| 200 words per call; 5000 words in a library; removing one makes room | `library-content-input` › how many words a library holds |
| A word of own: 1 to 120 characters after trimming, nothing added when refused | `library-regressions` › a word of my own |
| The local mirror and the SQL functions agree | `library-contract`, `library-differential` (need `PGURL`) |

## Pasted lists, content and import

| Rule | Test |
| --- | --- |
| Lines, commas, semicolons and Windows line ends separate words; blanks and null give nothing | `library-content-input` › a pasted list |
| Case and spacing are ignored; a meaning label picks that meaning; two meanings are "ambiguous" | same |
| A word repeated in another case is listed once | `library-regressions` › a pasted list that repeats a word |
| Search: empty gives nothing, limit, starts-with first, words without a meaning | `library-content-input` › finding a word by typing |
| A card becomes `sense_create` arguments (trim, defaults, `false` and `0` kept) | `library-content-input` › a word the player writes |
| A content file: every field named, duplicates, unknown type, opposites, stubs, player data, unknown parts, pairs | `library-content-input` › a content file |
| An empty entry in a list is reported, not a crash | `library-regressions` › a content file with an empty entry |
| Whole-file refusals, backups, modes | `import-export` (existing) |

## Mistakes found and fixed (each has a failing-first test)

1. A pasted list showed `zzz` and `ZZZ` as two missing words, and `cast` and `Cast` as two questions.
2. Local mode accepted a word of own over 120 characters (the database refuses it).
3. A content file with `null` in a list crashed the check with a `TypeError` instead of naming the place.
4. Typing questions showed the answer: the meaning "Zorb is a kind of thing" for the word "Zorb", or a gap sentence holding the word.

## Open points and gaps

These are decisions or limits, not tested as correct behaviour.

- **A one-word view of a new word has no questions.** The round shows the word, then ends, because the last introduced word is never the first question. Not changed: it is a product choice.
- **A letter swap counts as wrong, not as a spelling slip** (`campaing` for `campaign`). Spelling uses plain edit distance 1. The existing test is named "one-letter slip" but only checks `correct: false`.
- **The answer check for choice questions is by substring.** "Sane" with the meaning `Opposite of "Insane"` loses its choice questions. One word in the 989 of the backup. The typed check is by whole word.
- **Unknown words in a combo or an exclusion list** are turned into stub words on import, not reported.
- Screens (`WordHunter` start of a round, components) are tested only through the existing component tests and `npm run e2e`, not as units. `npm run e2e` was not run for this review.
- AI-written variants are not tested (out of scope on purpose).
- `library-contract` and `library-differential` are skipped without `PGURL`. For this review they ran on a throwaway local PostgreSQL 16 with every migration, together with all `supabase/tests/*.sql`: all passed.
