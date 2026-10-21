## Type
<!-- Tick exactly one. A behaviour change and a refactor go in separate PRs. -->
- [ ] Refactor (no behaviour change)
- [ ] Bug fix
- [ ] Feature
- [ ] Data or permissions (migrations, policies, production data: needs the owner's approval)
- [ ] Docs or tooling (no app code)

## Why
<!-- The problem, the current behaviour, the result wanted. -->

## What changed
<!-- The smallest change that does it; module boundaries kept. -->

## Verification
<!-- Commands and results. Bug fix: the test that failed before the fix. Refactor: what pinned the behaviour first.
     Feature: the acceptance criteria and their tests. Name every skipped test or check and why.
     If a bug fix or feature has no new test, write "No new test: <reason>". -->

## Docs
<!-- "Updated: <pages>" (Planned → Implemented where the work is done) or "Not needed: <reason>". -->

## Risks and gaps
<!-- What is not verified, what could go wrong, what is left. "None" is fine when true. -->

## Checklist (author and reviewer)
- [ ] Docs match the final code, not only the plan
- [ ] No test weakened or assertion removed to pass CI
- [ ] Required checks green on the latest commit; blocking review comments resolved
