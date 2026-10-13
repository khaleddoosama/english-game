// The library for this player: the API, and how a word or rule key maps to
// the id the server uses for it. In local mode ids are the keys themselves.
// Online, the library is "off" until the dictionary has been moved into the
// new tables (the rows carry the old key), so the screen never shows up
// half-working.
import { useEffect, useState } from "react";
import { isLocalMode, supabase } from "../../lib/supabase";
import { getLibraryApi } from "./libraryApi";
import { localAreFriends, localNameOf } from "../social/friendsApi";
import { identityIds, loadIds } from "./libraryIds";

export function useLibrary({ enabled, me, knownWord = () => true }) {
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    (async () => {
      try {
        if (isLocalMode) {
          const storage = window.localStorage;
          const api = getLibraryApi({ storage, me: () => me, canSee: knownWord, areFriends: (a, b) => localAreFriends(storage, a, b), nameOf: (id) => localNameOf(storage, id) });
          if (alive) setState({ status: "ready", api, ids: identityIds });
          return;
        }
        const api = getLibraryApi();
        await api.tree();                                   // fails while the tables aren't there
        const { ids, words } = await loadIds(supabase);
        if (!words) { if (alive) setState({ status: "off" }); return; }
        if (alive) setState({ status: "ready", api, ids });
      } catch { if (alive) setState({ status: "off" }); }
    })();
    return () => { alive = false; };
  }, [enabled, me]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
