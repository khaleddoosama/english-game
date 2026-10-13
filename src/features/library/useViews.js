// The state of the library screen that more than one part needs: my views as
// a tree, which one is open, what is directly inside it, and one way to run
// a change (busy, refresh, tell the player what happened).
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTree, flattenTree } from "./libraryTree";

export function useViews({ api, ids }) {
  const [flat, setFlat] = useState(null);
  const [selected, setSelected] = useState(null);
  const [inside, setInside] = useState({ words: [], rules: [] });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const roots = useMemo(() => buildTree(flat || []), [flat]);
  const rows = useMemo(() => flattenTree(roots), [roots]);
  const view = rows.find((v) => v.id === selected) || null;

  const loadTree = useCallback(async () => {
    try { setFlat(await api.tree()); } catch (e) { setNotice({ kind: "error", text: e.message }); setFlat([]); }
  }, [api]);
  const loadInside = useCallback(async () => {
    if (!selected) { setInside({ words: [], rules: [] }); return; }
    try {
      const list = await api.contents(selected, false);
      setInside({
        words: list.filter((x) => x.kind === "sense").map((x) => ids.keyOfSense(x.id)).filter(Boolean),
        rules: list.filter((x) => x.kind === "rule").map((x) => ids.keyOfRule(x.id)).filter(Boolean),
      });
    } catch (e) { setNotice({ kind: "error", text: e.message }); }
  }, [api, ids, selected]);
  useEffect(() => { loadTree(); }, [loadTree]);
  useEffect(() => { loadInside(); }, [loadInside]);

  // Runs a change, then reloads what it touched. okText: a string, or a
  // function of the result. Returns the result (undefined when it failed).
  const act = useCallback(async (fn, okText) => {
    setBusy(true); setNotice(null);
    try {
      const out = await fn();
      await Promise.all([loadTree(), loadInside()]);
      if (okText) setNotice({ kind: "ok", text: typeof okText === "function" ? okText(out) : okText });
      return out;
    } catch (e) { setNotice({ kind: "error", text: e.message }); return undefined; }
    finally { setBusy(false); }
  }, [loadTree, loadInside]);

  return { loading: flat === null, flat: flat || [], roots, rows, view, select: setSelected, inside, notice, setNotice, busy, setBusy, act, reloadTree: loadTree };
}
