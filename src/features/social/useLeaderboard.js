import { useEffect, useState } from "react";
import { fetchFriendsBoard, fetchLeaderboard } from "./socialApi";

// The rows of one Ranks tab: null while they load; an answer for a tab that is no longer chosen is dropped.
// The Friends tab reads the friends list first, then the player's and the friends' rows.
export function useLeaderboard(tab, me, friendsApi) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let stale = false;
    setRows(null); setError(null);
    const load = tab === "friends"
      ? friendsApi.list().then((l) => fetchFriendsBoard([me, ...l.friends.map((f) => f.id)]))
      : fetchLeaderboard(tab);
    load.then((r) => { if (!stale) setRows(r); }).catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [tab, me, friendsApi]);
  return { rows, error };
}
