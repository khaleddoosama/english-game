# ADR 0009: A small History API router instead of a routing library

- Status: Accepted. **Implemented.**
- Modules: [app-shell](../modules/app-shell/README.md)

## Context

Every page needs its own address so a refresh or a shared link opens the same view, and list filters should be in the address too.

## Decision

[router.js](../../src/lib/router.js) wraps the History API. It exposes `navigate`, a location hook built on `useSyncExternalStore`, pure functions `parseRoute` and `pathFor`, and query-string state hooks. Vercel and the service worker send every non-API path to `index.html`.

## Why

From the file's header comment: the app has a fixed, small set of pages, and the pure helpers are easy to test ([router.test.js](../../tests/router.test.js)).

## Alternatives (reconstructed)

- A routing library: more features (nested layouts, loaders) than this app uses.
- Keep screens in component state (as the original single file did): no deep links, no Back button.

## Consequences

- The play screens all share `/play`; which card shows is component state, so Back from a result card goes home or resumes the open session, not to the previous card.
- Route guards live in WordHunter, not in the router.
