// The public surface of the My Library module. Other modules import from here
// and from nowhere else in this folder (tests/library-boundary.test.js).
// Docs: docs/modules/my-library.md.
import { lazy } from "react";

export { useLibrary } from "./useLibrary";                    // the library for this player: { status, api, ids, refreshIds }
export { useLibraryHome } from "./useLibraryHome";            // offers, keys and biggest views, for Home and Profile
export { useMyViews, useViewScope } from "./useViewScope";    // my views, and what one holds, for Live challenges
export { scopeOfView } from "./viewRound";                    // a view as the scope of a practice round
export { scopeIsEmpty } from "./scope";
export { keepInLibrary } from "./ownWords";                   // a new word also goes into the library
export { default as LibraryRoutes } from "./LibraryRoutes";   // /join, /catalog and /library
export const MyViewsHome = lazy(() => import("./components/MyViewsHome"));   // the "My views" tabs on Home
