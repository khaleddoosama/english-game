import { useEffect, useRef } from "react";

// The game's waiting saves (progress, and the admin's content): each one runs after a short wait, so a burst of
// changes becomes one save, and at once when the page is hidden or left (reload, closing the tab, switching apps on a
// phone) instead of losing the last changes. Leaving while an admin's content edit is still being written asks first.
// Returns { debouncedSave(name, run, ms = 600) -> cancel, pendingSavesRef, runningSavesRef, contentWritesRef }:
// pendingSavesRef holds the saves still waiting (by name), runningSavesRef the promise of the last one started (by
// name), contentWritesRef the number of content writes in progress (useContentSave counts them).
// Docs: docs/modules/progress/progress-state.md.
export function useSaveQueue() {
  const pendingSavesRef = useRef({});
  const runningSavesRef = useRef({});
  const contentWritesRef = useRef(0);
  useEffect(() => {
    const flush = () => Object.values(pendingSavesRef.current).forEach((run) => run());
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    // An admin's content edit still being written: ask before leaving, as
    // a reload or closed tab would cut the write off.
    const onLeave = (e) => { flush(); if (contentWritesRef.current > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", onLeave); document.removeEventListener("visibilitychange", onHide); };
  }, []);
  function debouncedSave(name, run, ms = 600) {
    let done = false;
    const once = () => { if (done) return; done = true; if (pendingSavesRef.current[name] === once) delete pendingSavesRef.current[name]; runningSavesRef.current[name] = run(); };
    pendingSavesRef.current[name] = once;
    const handle = setTimeout(once, ms);
    return () => clearTimeout(handle);
  }
  return { debouncedSave, pendingSavesRef, runningSavesRef, contentWritesRef };
}
