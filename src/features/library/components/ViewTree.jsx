import { ChevronRight, Play } from "lucide-react";
import { count } from "./format";

// My views as an indented list: open one, or practise it.
export default function ViewTree({ rows, selected, onSelect, onPractice }) {
  if (!rows.length) return null;
  return (
    <ul className="lib-tree" aria-label="Your views">
      {rows.map((v) => (
        <li key={v.id} className={v.id === selected ? "on" : ""} style={{ "--depth": v.depth }}>
          <button className="lib-name" onClick={() => onSelect(v.id === selected ? null : v.id)} aria-pressed={v.id === selected}>
            <ChevronRight size={14} className="lib-chev" /> <b>{v.name}</b><small>{count(v.words, "word")} · {count(v.rules, "rule")}</small>
          </button>
          <button className="ui-row-btn lib-go" disabled={!v.words && !v.rules && !v.children.length} onClick={() => onPractice(v.id, true, v.name)} title="Practise this view and the views inside it"><Play size={14} /> Practise</button>
        </li>
      ))}
    </ul>
  );
}
