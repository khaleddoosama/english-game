import { useEffect, useState } from "react";
import { isLocalMode } from "../../lib/supabase";
import { fetchLiveHistory } from "./socialApi";

// The player's recent Live matches for the profile: null while they load; none in local mode or when the read fails.
export function useLiveHistory(userId) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!userId || isLocalMode) { setHistory([]); return; }
    fetchLiveHistory(userId).then(setHistory).catch(() => setHistory([]));
  }, [userId]);
  return history;
}
