import { useState } from "react";

// UI-only state shared by the editable tree and Home's read-only tree.
export function useViewExpansion() {
  const [folded, setFolded] = useState(() => new Set());
  const toggle = (id) => setFolded((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  return { folded, toggle };
}
