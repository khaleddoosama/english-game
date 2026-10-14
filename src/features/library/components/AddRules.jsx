import { useMemo, useState } from "react";
import WordPicker from "./WordPicker";
import { useSelection } from "./useSelection";
import { ruleItems, ruleKey, ruleName } from "./ruleItems";
import { count } from "./format";

// Put grammar rules in the open view: search them, narrow by lesson and level,
// tick, add. Rules already in the view are shown ticked.
export default function AddRules({ grammar, libraryRuleKeys, inView, busy, onAdd }) {
  const sel = useSelection();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(libraryRuleKeys.size ? "library" : "all");
  const all = useMemo(() => ruleItems(grammar), [grammar]);
  const pool = useMemo(() => (source === "library" ? all.filter((r) => libraryRuleKeys.has(r.id)) : all), [source, all, libraryRuleKeys]);
  if (!all.length) return null;
  return (
    <details className="lib-add-rules" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Add grammar rules</summary>
      {open && <>
      <div className="lib-source" role="group" aria-label="Where to take rules from">
        <button className={`chip ${source === "library" ? "on" : ""}`} aria-pressed={source === "library"} onClick={() => setSource("library")}>From my library ({libraryRuleKeys.size})</button>
        <button className={`chip ${source === "all" ? "on" : ""}`} aria-pressed={source === "all"} onClick={() => setSource("all")}>All grammar rules ({all.length})</button>
      </div>
      <WordPicker words={pool} selected={sel.set} disabled={inView} disabledLabel="in this view" onToggle={sel.toggle} onSetMany={sel.setMany}
        keyOf={ruleKey} nameOf={ruleName} noun="rule" searchLabel="Search grammar rules" placeholder="Search grammar rules"
        empty={(q) => <p className="ui-muted">{q ? <>No rule matches “{q}”.</> : source === "library" ? "Your library has no grammar rules yet." : "No grammar rules."}</p>} />
      {sel.set.size > 0 && (
        <div className="lib-actionbar">
          <button className="ui-row-btn lib-primary" disabled={busy} onClick={async () => { await onAdd([...sel.set]); sel.clear(); }}>Add {count(sel.set.size, "rule")}</button>
          <button className="lib-link" onClick={sel.clear}>Clear</button>
        </div>
      )}
      </>}
    </details>
  );
}
