import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { navigate } from "../../../lib/router";
import WordPicker from "./WordPicker";
import { useSelection } from "./useSelection";
import { ruleItems, ruleKey, ruleName } from "./ruleItems";
import { count } from "./format";

// The grammar rules in my library: search, tick, then put them in a view or
// take them out of the library (which takes them out of my views too, after a
// second tap). The admin can open a ticked rule in the grammar editor, which
// is where a rule's wording is changed for everyone.
export default function LibraryRules({ rules, grammar, rows, busy, isAdmin = false, onAddToView, onRemove }) {
  const sel = useSelection();
  const [target, setTarget] = useState("");
  const [sure, setSure] = useState(false);
  const mine = useMemo(() => new Set(rules.map((r) => r.key)), [rules]);
  const pool = useMemo(() => ruleItems(grammar).filter((r) => mine.has(r.id)), [grammar, mine]);
  if (!rules.length) return null;
  const keys = [...sel.set];

  async function addTo(e) {
    e.preventDefault();
    if (!target) return;
    if ((await onAddToView(target, keys)) !== undefined) { sel.clear(); setTarget(""); }
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if ((await onRemove(keys)) !== undefined) sel.clear();
  }

  return (
    <div className="lib-rules">
      <h4 className="lib-sub">Grammar rules <small>{rules.length}</small></h4>
      <WordPicker filterUnits words={pool} selected={sel.set} onToggle={(k) => { setSure(false); sel.toggle(k); }} onSetMany={sel.setMany}
        keyOf={ruleKey} nameOf={ruleName} noun="rule" searchLabel="Search your grammar rules" placeholder="Search your grammar rules"
        empty={(q) => <p className="ui-muted">No rule matches “{q}”.</p>} />
      {keys.length > 0 && (
        <form className="lib-actionbar" onSubmit={addTo}>
          <span>{count(keys.length, "rule")} selected</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Add rules to view">
            <option value="">Add to view…</option>
            {rows.map((v) => <option key={v.id} value={v.id}>{"— ".repeat(v.depth)}{v.name}</option>)}
          </select>
          <button className="ui-row-btn lib-primary" disabled={busy || !target}>Add</button>
          {isAdmin && keys.length === 1 && <button type="button" className="ui-row-btn" onClick={() => navigate(`/admin/grammar/${encodeURIComponent(keys[0])}`)}><Pencil size={13} /> Edit rule</button>}
          <button type="button" className="ui-row-btn" disabled={busy} onClick={remove}>{sure ? "Tap again to remove from library" : "Remove from library"}</button>
          <button type="button" className="lib-link" onClick={() => { sel.clear(); setSure(false); }}>Clear</button>
        </form>
      )}
    </div>
  );
}
