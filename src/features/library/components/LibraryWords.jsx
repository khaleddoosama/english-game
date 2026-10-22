import { useMemo, useState } from "react";
import { count } from "./format";
import LibraryRules from "./LibraryRules";
import WordPicker from "./WordPicker";
import { useSelection } from "./useSelection";

// My library: every word I have, whether or not it is in a view. Tick some
// and put them in a view (an existing one, or a new one made from them), or
// take them out of the library, which takes them out of every view too.
export default function LibraryWords({ items, rows, grammar = [], isAdmin = false, wordByKey, busy, onAddToView, onNewView, onRemove, onAddRulesToView, onRemoveRules }) {
  const sel = useSelection();
  const [only, setOnly] = useState("all");           // all | loose (not in any view)
  const [target, setTarget] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);

  const viewsOf = useMemo(() => new Map(items.words.map((w) => [w.key, w.views])), [items.words]);
  const unitItems = useMemo(() => items.words.map((w) => wordByKey.get(w.key)).filter(Boolean), [items.words, wordByKey]);
  const pool = useMemo(() => items.words.filter((w) => only === "all" || w.views === 0).map((w) => wordByKey.get(w.key)).filter(Boolean), [items.words, only, wordByKey]);
  const loose = items.words.filter((w) => w.views === 0).length;

  if (!items.words.length && !items.rules.length) {
    return <div className="lib-empty"><p><b>Your library has no words yet.</b> Add words from a view (search the dictionary, paste a list, or start from a course level), or open a link a friend sent you.</p></div>;
  }
  const keys = [...sel.set];
  async function addTo(e) {
    e.preventDefault();
    if (naming ? !name.trim() : !target) return;
    const ok = naming ? await onNewView(name, keys) : await onAddToView(target, keys);
    if (ok !== undefined) { sel.clear(); setName(""); setNaming(false); setTarget(""); }
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if ((await onRemove(keys)) !== undefined) sel.clear();
  }

  return (
    <div className="lib-words">
      <p className="lib-summary">{count(items.words.length, "word")}{items.rules.length ? ` · ${count(items.rules.length, "rule")}` : ""} in your library{loose ? ` · ${loose} not in any view` : ""}</p>
      {!items.words.length && <p className="ui-muted">No words in your library yet, only grammar rules (below).</p>}
      {items.words.length > 0 && <WordPicker filterUnits unitItems={unitItems} words={pool} selected={sel.set} onToggle={sel.toggle} onSetMany={sel.setMany} searchLabel="Search your library" placeholder="Search your library" tagOf={(k) => (viewsOf.get(k) ? `in ${count(viewsOf.get(k), "view")}` : "no view")}
        empty={() => <p className="ui-muted">Nothing matches.</p>}>
        <div className="lib-source" role="group" aria-label="Which words">
          <button className={`chip ${only === "all" ? "on" : ""}`} aria-pressed={only === "all"} onClick={() => setOnly("all")}>All</button>
          <button className={`chip ${only === "loose" ? "on" : ""}`} aria-pressed={only === "loose"} onClick={() => setOnly("loose")}>Not in a view ({loose})</button>
        </div>
      </WordPicker>}

      {sel.set.size > 0 && (
        <form className="lib-actionbar" onSubmit={addTo}>
          <b>{count(sel.set.size, "word")} selected</b>
          {!naming ? (
            <>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Add to view">
                <option value="">Add to view…</option>
                {rows.map((v) => <option key={v.id} value={v.id}>{"— ".repeat(v.depth)}{v.name}</option>)}
              </select>
              <button className="ui-row-btn lib-primary" disabled={busy || !target}>Add</button>
              <button type="button" className="ui-row-btn" onClick={() => setNaming(true)}>New view…</button>
            </>
          ) : (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name of the new view" aria-label="New view from these words" autoFocus />
              <button className="ui-row-btn lib-primary" disabled={busy || !name.trim()}>Create and add</button>
              <button type="button" className="ui-row-btn" onClick={() => setNaming(false)}>Cancel</button>
            </>
          )}
          <button type="button" className={`ui-row-btn ${sure ? "lib-danger" : ""}`} disabled={busy} onClick={remove}>{sure ? "Tap again to remove from library" : "Remove from library"}</button>
          <button type="button" className="lib-link" onClick={sel.clear}>Clear</button>
        </form>
      )}

      <LibraryRules rules={items.rules} grammar={grammar} rows={rows} busy={busy} isAdmin={isAdmin} onAddToView={onAddRulesToView} onRemove={onRemoveRules} />
    </div>
  );
}
