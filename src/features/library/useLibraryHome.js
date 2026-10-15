// What the app shell reads from the library for Home and the Profile: how many
// offers are waiting, the player's own words and rules (to cut Home down to
// them) and their biggest views (the tabs). The keys and views are read again
// whenever Home opens, and the views again when the offers change.
import { useCallback, useEffect, useState } from "react";
import { keysFromList, rootsFromTree } from "./libraryHome";

const HOME = "levels";

export function useLibraryHome({ library, screen }) {
  const ready = library.status === "ready";
  const [inbox, setInbox] = useState(0);
  const refreshInbox = useCallback(() => {
    if (!ready) return;
    library.api.inbox().then((list) => setInbox(list.length), () => {});
  }, [library]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshInbox(); }, [refreshInbox, screen]);

  const [keys, setKeys] = useState(null);
  useEffect(() => {
    if (!ready || screen !== HOME) return undefined;
    let alive = true;
    library.api.libraryList().then((list) => alive && setKeys(keysFromList(list, library.ids)), () => {});
    return () => { alive = false; };
  }, [library, screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [roots, setRoots] = useState(null);
  useEffect(() => {
    if (!ready || screen !== HOME) return undefined;
    let alive = true;
    library.api.tree().then((rows) => alive && setRoots(rootsFromTree(rows)), () => {});
    return () => { alive = false; };
  }, [library, screen, inbox]); // eslint-disable-line react-hooks/exhaustive-deps

  return { inbox, refreshInbox, keys, roots };
}
