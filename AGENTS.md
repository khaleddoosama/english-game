# Agent instructions

Word Hunter: React + Vite, Supabase, Vercel Functions. Owner's rules: [CLAUDE.md](CLAUDE.md). Full workflow:
[docs/development-workflow.md](docs/development-workflow.md). Docs index: [docs/README.md](docs/README.md).

For every change, before writing code and until the merge:

1. **Scope.** Read the repository instructions and the docs of the module you touch. Write the problem, current
   behaviour, wanted result and acceptance criteria. Pick one type: refactor, bug fix, feature, data or permissions,
   docs or tooling. Never mix a behaviour change with a refactor.
2. **Docs first, when affected.** Behaviour, interface, responsibilities, dependencies or how to run it: update the
   owning page and mark it **Planned**, then build. ADR only for a real architectural decision. Nothing affected:
   say why in the PR.
3. **Verify.** Bug fix: a test that fails before the fix. Refactor: pin behaviour before moving. Feature: test the
   acceptance criteria. Never weaken a test to pass CI.
4. **Close.** Smallest change, module boundaries kept. Docs match the final code; **Planned** becomes **Implemented**
   only when done. Name skipped tests and open gaps. Fill in the PR template.
5. **Merge** only with the required checks green on the latest commit, blocking review comments resolved, docs
   updated or the reason given, nothing bypassed, no force push to `master`, and the owner's approval (or delegation).

CI checks what it can (`pr-rules`, `tests/repo-rules.test.js`, the architecture guards). `master` is protected on GitHub:
`app`, `database`, `e2e`, `pr-rules` and `realstack` must pass for everyone, administrators included (see the
workflow page). What review must judge (docs content, order of work), CI cannot.
