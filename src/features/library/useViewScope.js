// What other screens need from the library: my views (to offer as a source of
// words) and, for one of them, which words and rules it holds.
import { useEffect, useState } from "react";
import { scopeFromContents } from "./scope";

// My views, flat. Empty when there is no library.
export function useMyViews(library) {
  const [views, setViews] = useState([]);
  useEffect(() => {
    if (!library) return undefined;
    let alive = true;
    library.api.tree().then((t) => alive && setViews(t), () => {});
    return () => { alive = false; };
  }, [library]);
  return views;
}

// { words: Set of word keys, rules: Set of rule ids } for a view and the views
// inside it; null until it has loaded (or when no view is picked).
export function useViewScope(library, viewId) {
  const [scope, setScope] = useState(null);
  useEffect(() => {
    if (!viewId || !library) { setScope(null); return undefined; }
    let alive = true;
    library.api.contents(viewId, true).then(
      (rows) => alive && setScope(scopeFromContents(rows, { resolveKey: library.ids.keyOfSense, resolveRule: library.ids.keyOfRule })),
      () => alive && setScope({ words: new Set(), rules: new Set() }));
    return () => { alive = false; };
  }, [viewId, library]);
  return scope;
}
