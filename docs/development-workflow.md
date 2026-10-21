# Development workflow

Status: **Implemented** (2026-10-21). Every change to this repository, by a person or an agent, follows these steps
from the first line of code to the merge. [AGENTS.md](../AGENTS.md) is the short version; [CLAUDE.md](../CLAUDE.md)
adds the owner's working rules (branch, approvals, test data, language). Keep it in proportion: a one-line fix needs a
one-line answer to each step, not a document.

## 1. Understand the scope before the code

- Read the repository instructions and the docs of the module you will touch (start from [README.md](README.md)),
  not everything.
- Write down: the problem, the current behaviour, the result wanted, and how you will know it is done (acceptance
  criteria).
- Pick one type: **refactor** (no behaviour change), **bug fix**, **feature**, **data or permissions** (migrations,
  policies, production data), or **docs or tooling**. A behaviour change and a refactor never share a PR.

## 2. Docs before the code (when they are affected)

- If the change touches behaviour, an interface, a module's responsibilities or dependencies, or how the project
  runs, first update the page that owns it and mark the new part **Planned**. Then build it.
- Write an [ADR](adr/README.md) only for an architectural decision with real alternatives and trade-offs.
- When no doc is affected (an internal change with the same contracts and responsibilities), say why in the PR;
  do not make cosmetic doc edits. The rules for what goes where are in
  [README.md](README.md#documentation-rules).

## 3. Verify in proportion

| Type | Test |
| --- | --- |
| Bug fix | A test that reproduces the bug and fails before the fix, when that is practical; otherwise say why. |
| Refactor | Pin the behaviour first (a test or browser spec that passes before the move), then move. |
| Feature | Tests for the acceptance criteria. |
| Data or permissions | SQL tests on a fresh database, a rollback, and the owner's approval before any production change. |
| Docs or tooling | The checks it adds, with a passing and a failing case. |

Never weaken a test or remove an assertion to get CI green. Do not add tests that only repeat the implementation.

## 4. Build and close

- Make the smallest change that does it, inside the module boundaries (`tests/architecture.test.js` guards them).
- Before closing, check the docs against the final code and turn **Planned** into **Implemented** only for what is
  done. Write limits and gaps down (Known Issues); a skipped test or check is not a pass, name it.
- The PR description ([template](../.github/pull_request_template.md)) says why, what changed, how it was verified,
  what it does to the docs, and the risks and gaps.

## 5. Merge only when

- the required checks are green on the **latest** commit (merge with that commit's full SHA as the expected head);
- blocking review comments are resolved;
- the docs are updated, or the PR says why not;
- nothing was bypassed: no skipped check, no force push to `master`.

The owner approves each merge unless they delegated it for that work ([CLAUDE.md](../CLAUDE.md)).

## What the machine checks, and what it does not

| Rule | Where | On |
| --- | --- | --- |
| PR description has Why, What changed, Verification, Docs, Risks and gaps; exactly one type | `scripts/pr-rules.mjs` (job `pr-rules`) | every PR and every edit of its description |
| "Docs or tooling" changes no app code (`src/`, `api/`) | same | PR |
| Migrations or rollbacks changed → type is "Data or permissions" | same | PR |
| Bug fix or feature changes a test (`tests/`, `e2e/specs/`, `supabase/tests/`) or says "No new test: <reason>" | same | PR |
| Docs line is "Updated: …" with a doc file in the diff, or "Not needed: <reason>"; a feature or data change cannot say "Not needed" | same | PR |
| No `.only`, `.skip` or `.todo` in tests or specs (a suite that needs a service uses `describe.skipIf(!ENV)`) | `tests/repo-rules.test.js` (job `app`) | every push |
| Every relative link in the docs points to a file that exists | same | every push |
| Module boundaries, no import loops, the engine imports no module | `tests/architecture.test.js` | every push |
| Every export in `src/` is used | `tests/unused-exports.test.js` | every push |

The PR check sees that a doc changed, not that it is right; it cannot see whether the docs came before the code or
whether a refactor really kept behaviour. Those are for the reviewer, with the checklist in the template.

## Settings this needs on GitHub (owner)

These files cannot stop a merge by themselves: GitHub enforces nothing until the repository is set up. In
**Settings → Branches → Branch protection rule** (or a ruleset) for `master`:

- require a pull request before merging;
- require these status checks to pass, on the latest commit: `app`, `e2e`, `database`, `pr-rules`;
- block force pushes and deletion of `master`;
- apply the rule to administrators too (otherwise the owner's account, which agents use, can bypass it);
- required approvals: only if a second person reviews. An agent working with the owner's account cannot approve its
  own PRs, so a required approval would block every agent merge.

Status on 2026-10-21: **not set**. The GitHub API reports `master` as not protected, and the agent has no permission
to change repository settings. Until the owner sets it, these rules hold by agreement and review, not technically.
