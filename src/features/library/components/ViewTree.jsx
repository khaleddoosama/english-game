import { Play } from "lucide-react";
import { visibleRows } from "../libraryTree";
import { FoldButton, useFolded } from "./Fold";
import { count } from "./format";

// My views as an indented list. The arrow folds the views inside one (they are
// all open at first); tapping the name opens it, right under its row (`panel`
// draws it); Practise plays it and the views inside it. The counts are
// everything in the view and the views inside it, each word once.
export default function ViewTree({ rows, selected, onSelect, onPractice, panel = null }) {
  const { folded, toggle } = useFolded();
  if (!rows.length) return null;
  return (
    <ul className="lib-tree" aria-label="Your views">
      {visibleRows(rows, folded).map((v) => {
        const open = v.id === selected;
        const words = v.deep_words ?? v.words, rules = v.deep_rules ?? v.rules;
        return (
          <li key={v.id} className={open ? "on" : ""} style={{ "--depth": v.depth }}>
            {v.children.length > 0
              ? <FoldButton name={v.name} open={!folded.has(v.id)} onToggle={() => toggle(v.id)} />
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
