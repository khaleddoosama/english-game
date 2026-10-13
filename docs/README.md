# Word Hunter — developer docs

These docs explain how the project works, from the code to the database.
They were written by reading the real code (not from memory), so each
section names the file and the function to open.

| # | Doc | Read it when you want to know… |
|---|---|---|
| 1 | [architecture.md](architecture.md) | the big picture: folders, data flow, security, deploy, tests |
| 2 | [question-options.md](question-options.md) | **how the answer choices (options/distractors) are created** |
| 3 | [data-reference.md](data-reference.md) | **what every key in the data is for** (words, grammar, progress, settings) |
| 4 | [database.md](database.md) | every Supabase table, function, policy and bucket |
| 5 | [ai-usage.md](ai-usage.md) | **every place AI is used**, and how a call travels and is limited |
| 6 | [live-challenge.md](live-challenge.md) | **how Live Challenge works** and **how to make it more real-time** |
| 7 | [progress-and-mastery.md](progress-and-mastery.md) | how a round is built, how mastery is scored, how saving and merging work |
| — | [ai-usage-inventory.md](ai-usage-inventory.md) | the older Arabic list of AI uses (kept; doc 5 is the English, code-checked version) |

## Words you will see everywhere

- **Word / item** — one entry in `content_items` with `kind = words`. Its text (`word`) is also its key.
- **Pool** — the list of sentences a word keeps per question style (`meaning`, `gap`, `situation`, `typing`). The authored text is `seed`; AI adds `gen-…` variants.
- **Mastery** — one record per word per player. Stage: New → Familiar → Learned → Mastered.
- **Production** — the player *types* the answer (typing, gap typing). Choosing from options is *recognition*.
- **Distractor** — a wrong option.
- **Live Challenge** — a link-based multiplayer quiz (2–10 players).
- **Local mode** — no Supabase settings: everything is in the browser, AI is off.

## Suggested reading order for a new teammate

1. architecture.md (20 min)
2. data-reference.md — Word entry table (10 min)
3. question-options.md (20 min)
4. progress-and-mastery.md
5. Then pick: database.md / ai-usage.md / live-challenge.md.

## Keeping these docs true

Line numbers drift, so the docs point to **function names**. If you change
the behaviour of a function named here, update the doc in the same commit.
