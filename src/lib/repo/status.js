// Status listeners: the header shows saving / offline / error.
export function createStatusHub() {
  const subs = new Set();
  let current = "idle";
  return {
    get: () => current,
    set(next) { if (next === current) return; current = next; subs.forEach((fn) => fn(next)); },
    subscribe(fn) { subs.add(fn); fn(current); return () => subs.delete(fn); },
  };
}
