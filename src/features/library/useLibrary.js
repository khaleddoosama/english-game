// The library for this player: the API, and how a word or rule key maps to
// the id the server uses for it. In local mode ids are the keys themselves.
// Online, the library is "off" until the dictionary has been moved into the
// new tables (the rows carry the old key), so the screen never shows up
// half-working.
import { useEffect, useState } from "react";
import { isLocalMode, supabase } from "../../lib/supabase";
import { getLibraryApi } from "./libraryApi";
import { localAreFriends, localNameOf } from "../social/friendsApi";

const identity = { senseOf: (k) => k, keyOfSense: (id) => id, ruleOf: (k) => k, keyOfRule: (id) => id };

async function loadMap(table) {
  const out = new Map();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from(table).select("id, legacy_key").not("legacy_key", "is", null).range(from, from + 999);
    if (error) throw error;
    for (const r of data) out.set(r.legacy_key, r.id);
    if (data.length < 1000) break;
  }
  return out;
}

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
          if (alive) setState({ status: "ready", api, ids: identity });
          return;
        }
        const api = getLibraryApi();
        await api.tree();                                   // fails while the tables aren't there
        const [senses, rules] = await Promise.all([loadMap("senses"), loadMap("grammar_rules")]);
        if (!senses.size) { if (alive) setState({ status: "off" }); return; }
        const bySense = new Map([...senses].map(([k, id]) => [id, k])), byRule = new Map([...rules].map(([k, id]) => [id, k]));
        const ids = { senseOf: (k) => senses.get(k), keyOfSense: (id) => bySense.get(id), ruleOf: (k) => rules.get(k), keyOfRule: (id) => byRule.get(id) };
        if (alive) setState({ status: "ready", api, ids });
      } catch { if (alive) setState({ status: "off" }); }
    })();
    return () => { alive = false; };
  }, [enabled, me]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
