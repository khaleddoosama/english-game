import { Suspense, lazy } from "react";

// The library's own screens, for the app shell to place: /join/<token>,
// /catalog and /library. Each is its own chunk. The link page and the catalog
// say so while the library is loading or off; the library page shows nothing
// until it is ready.
const LibraryPage = lazy(() => import("./LibraryPage"));
const JoinPage = lazy(() => import("./JoinPage"));
const CatalogPage = lazy(() => import("./CatalogPage"));

const NOT_THERE = {
  join: "Shared views aren’t available yet.",
  catalog: "The catalog isn’t available yet.",
};
const Waiting = ({ screen, status }) => <section className="ui-page"><p className="ui-muted">{status === "loading" ? "Loading…" : NOT_THERE[screen]}</p></section>;

//   screen   "join" | "library" | "catalog"          fallback  what to show while a chunk loads
//   library  the useLibrary() value                  route     { token } for /join/<token>
//   words, grammar, levels, friendsApi, isAdmin      the app's content and people
//   onPractice(viewId, deep, name)   start a round   onAskWord(term)  open the AI helper
//   onInboxChanged()                 offers changed  onJoined(out, open)  a link was taken
export default function LibraryRoutes({ screen, library, route, fallback, isAdmin = false, words, grammar, levels, friendsApi, onPractice, onAskWord, onInboxChanged, onJoined }) {
  if (screen === "library") {
    return library.status === "ready" ? (
      <Suspense fallback={fallback}>
        <LibraryPage isAdmin={isAdmin} api={library.api} ids={library.ids} words={words} grammar={grammar} levels={levels} friendsApi={friendsApi}
          onPractice={onPractice} onInboxChanged={onInboxChanged} onAskWord={onAskWord} onRefreshIds={library.refreshIds} />
      </Suspense>
    ) : null;
  }
  if (screen !== "join" && screen !== "catalog") return null;
  if (library.status !== "ready") return <Waiting screen={screen} status={library.status} />;
  return (
    <Suspense fallback={fallback}>
      {screen === "join"
        ? <JoinPage api={library.api} token={route.token} onTaken={onJoined} />
        : <CatalogPage api={library.api} isAdmin={isAdmin} onTaken={onInboxChanged} />}
    </Suspense>
  );
}
