import { useCallback, useEffect, useRef, useState } from "react";
import { NO_COUNTS, nextCounts, socialStorageKey } from "./socialRules";

// How many friend requests and Live invitations are waiting, for the badges
// on the navigation. Checked when the game opens, every 45 seconds, when the
// tab comes back into view, and (in local mode) when another tab changes
// something. A failed check just keeps the last numbers.
export const SOCIAL_POLL_MS = 45000;

// Calls `refresh` every 45 seconds, when the tab comes back into view or gets
// focus, and when another tab changes friends or Live data (local mode).
export function useRefreshOnActivity(refresh, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(refresh, SOCIAL_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onStorage = (e) => { if (socialStorageKey(e.key)) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh, enabled]);
}

export function useSocialCounts(api, enabled = true) {
  const [counts, setCounts] = useState(NO_COUNTS);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (!api || !enabled) return;
    try {
      const c = await api.counts();
      if (alive.current) setCounts((old) => nextCounts(old, c));
    } catch { /* keep the last numbers */ }
  }, [api, enabled]);
  useEffect(() => {
    alive.current = true;
    if (!enabled) setCounts(NO_COUNTS); else refresh();
    return () => { alive.current = false; };
  }, [refresh, enabled]);
  useRefreshOnActivity(refresh, enabled);
  return { counts, refresh };
}
