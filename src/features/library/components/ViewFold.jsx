import { ChevronRight } from "lucide-react";

export default function ViewFold({ view, folded, onToggle }) {
  if (!view.children.length) return null;
  return <button type="button" className="lib-fold"
    aria-label={`${folded ? "Show" : "Hide"} the views inside ${view.name}`}
    aria-expanded={!folded} onClick={(e) => { e.stopPropagation(); onToggle(view.id); }}>
    <ChevronRight size={18} aria-hidden="true" className={`lib-chev ${folded ? "" : "down"}`} />
  </button>;
}
