// The library for this player: the API, and how a word or rule key maps to
// the id the server uses for it. In local mode ids are the keys themselves.
// Online, the library is "off" until the dictionary has been moved into the
// new tables (the rows carry the old key), so the screen never shows up
// half-working.
import { useCallback, useEffect, useMemo, useState } from "react";
import { isLocalMode, supabase } from "../../lib/supabase";
import { identityIds, loadIds } from "./libraryIds";
import { openLibrary } from "./openLibrary";

//   enabled  start once the course has loaded      me  the player's id
//   knownWord(key)  is this word in the game (local mode: what may be added)
//   people   local mode only: { areFriends(a, b), nameOf(id) }, who the player's friends are
//            (the library does not import the friends module; the app passes it in)
export function useLibrary({ enabled, me, knownWord = () => true, people = null }) {
  const [state, setState] = useState({ status: "loading" });
  // Words added after the app started aren't in the id map yet; this reloads it.
  // Local mode has nothing to reload (a key is its own id).
  const refreshIds = useCallback(async () => {
    if (isLocalMode) return identityIds;
    const { ids } = await loadIds(supabase);
    setState((cur) => (cur.status === "ready" ? { ...cur, ids } : cur));
    return ids;
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const storage = isLocalMode ? window.localStorage : null;
    const local = isLocalMode ? { storage, me: () => me, canSee: knownWord, areFriends: people?.areFriends, nameOf: people?.nameOf } : null;
    openLibrary({ local, client: supabase }).then((next) => { if (alive) setState(next); });
    return () => { alive = false; };
  }, [enabled, me]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...state, refreshIds }), [state, refreshIds]);
}
