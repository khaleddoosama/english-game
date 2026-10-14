import { useCallback, useState } from "react";

// A set of picked keys: toggle one, set many on or off, clear.
export function useSelection() {
  const [set, setSet] = useState(() => new Set());
  const toggle = useCallback((k) => setSet((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }), []);
  const setMany = useCallback((keys, on) => setSet((s) => { const n = new Set(s); for (const k of keys) on ? n.add(k) : n.delete(k); return n; }), []);
  const clear = useCallback(() => setSet(new Set()), []);
  return { set, toggle, setMany, clear };
}
