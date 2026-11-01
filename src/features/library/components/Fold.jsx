import { useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";

// Folding the views inside a view, the same way wherever views are drawn as a
// tree (the library page and My views on Home). Everything starts unfolded;
// the fold lasts while the screen is open and changes nothing else: no data,
// not which view is open, not what Practise plays.
export function useFolded() {
  const [folded, setFolded] = useState(() => new Set());
  const toggle = useCallback((id) => setFolded((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  return { folded, toggle };
}

// The arrow next to a view that has views inside it (callers draw it only
// then). It folds or unfolds, nothing more.
export function FoldButton({ name, open, onToggle }) {
  const label = `${open ? "Hide" : "Show"} the views inside ${name}`;
  return (
    <button type="button" className="lib-fold" aria-label={label} title={label} aria-expanded={open} onClick={onToggle}>
      <ChevronRight size={18} aria-hidden="true" className={`lib-chev ${open ? "down" : ""}`} />
    </button>
  );
}
