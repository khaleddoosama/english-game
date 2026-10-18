# ADR 0006: AI only through server functions with a task list and a database gate

- Status: Accepted. **Implemented.**
- Modules: [ai-media](../modules/ai-media/README.md), [accounts](../modules/accounts/README.md)

## Context

AI features cost money and the key must never reach a browser. Some features are for the admin only. Players need a daily limit, and the admin wants a record of every call.

## Decision

The browser sends `{ prompt, task }` to a Vercel Function with the player's token. The function accepts only task names listed in [tasks.js](../../api/_lib/tasks.js) (which also says which are admin-only and how big a prompt may be), asks the database function `ai_gate` to check the token, role, switches and daily quota and to log the call, then calls Gemini. The server finishes the log row with its own key.

## Why

From [api/ai.js](../../api/ai.js), [gate.js](../../api/_lib/gate.js) and migrations 0004, 0012, 0015, 0019: the browser's claim about "admin only" cannot be trusted, so the server decides from the task name; players cannot rewrite their own log rows.

## Alternatives (reconstructed)

- Call Gemini from the browser: exposes the key.
- Gate only in the function: loses the shared quota and log that the admin pages read from the database.
- Fix the prompts on the server: stronger control, but prompts are long and change with the game, and the server would need the game's content.

## Consequences

- Prompts are written in the browser, so a signed-in player can send any text within the task's size limit and use the AI as a general chat within the daily quota (`PE-04`).
- Each AI feature needs an entry in the task list; an unknown name is refused (the error asks the player to reload).
- A cached pronunciation clip plays even when AI pronunciation is switched off.
