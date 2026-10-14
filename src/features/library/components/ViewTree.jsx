import { useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { count } from "./format";

// My views as an indented list. The arrow folds the views inside one (they are
// all open at first); tapping the name opens it, right under its row (`panel`
// draws it); Practise plays it and the views inside it. The counts are
// everything in the view and the views inside it, each word once.
export default function ViewTree({ rows, selected, onSelect, onPractice, panel = null }) {
  const [folded, setFolded] = useState(() => new Set());
  if (!rows.length) return null;
  const toggle = (id) => setFolded((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // a row is hidden when a view above it is folded
  const hidden = (v) => { for (let p = v.parent && rows.find((r) => r.id === v.parent); p; p = p.parent && rows.find((r) => r.id === p.parent)) if (folded.has(p.id)) return true; return false; };
  return (
    <ul className="lib-tree" aria-label="Your views">
      {rows.filter((v) => !hidden(v)).map((v) => {
        const open = v.id === selected;
        const kids = v.children.length > 0;
        const words = v.deep_words ?? v.words, rules = v.deep_rules ?? v.rules;
        return (
          <li key={v.id} className={open ? "on" : ""} style={{ "--depth": v.depth }}>
            {kids
              ? <button className="lib-fold" aria-label={`${folded.has(v.id) ? "Show" : "Hide"} the views inside ${v.name}`} aria-expanded={!folded.has(v.id)} onClick={() => toggle(v.id)}><ChevronRight size={14} className={`lib-chev ${folded.has(v.id) ? "" : "down"}`} /></button>
              : <span className="lib-fold-gap" />}
            <button className="lib-name" onClick={() => onSelect(open ? null : v.id)} aria-pressed={open}>
              <b>{v.name}</b><small>{count(words, "word")} · {count(rules, "rule")}</small>
            </button>
            <button className="ui-row-btn lib-go" disabled={!words && !rules} onClick={() => onPractice(v.id, true, v.name)} title="Practise this view and the views inside it"><Play size={14} /> Practise</button>
            {open && panel && <div className="lib-inline-panel">{panel}</div>}
          </li>
        );
      })}
    </ul>
  );
}
