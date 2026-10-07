import { useCallback, useEffect, useState } from "react";
import { Check, UserPlus } from "lucide-react";
import "../../styles/friends.css";

// Who is already a friend, who was asked, and who asked me: one list for a
// whole screen, so every name on it can show the right small button.
export function useFriendStatus(api, enabled = true) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    if (!api || !enabled) return;
    try { setData(await api.list()); } catch { setData((old) => old || { friends: [], incoming: [], outgoing: [] }); }
  }, [api, enabled]);
  useEffect(() => { load(); }, [load]);
  const statusOf = useCallback((id) => {
    if (!data) return "unknown";
    if (data.friends.some((p) => p.id === id)) return "friend";
    if (data.outgoing.some((p) => p.id === id)) return "sent";
    if (data.incoming.some((p) => p.id === id)) return "incoming";
    return "none";
  }, [data]);
  return { data, statusOf, reload: load };
}

// A small button after a player's name: + Add, Requested, Accept, or a tick.
export function AddFriendButton({ api, status, person, onChange, tone = "dark" }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  if (!api || status === "unknown") return null;
  const cls = `fr-add${tone === "paper" ? " on-paper" : ""}`;
  if (status === "friend") return <span className={`${cls} fr-is-friend`} title="Friends"><Check size={11} /> Friends</span>;
  if (status === "sent") return <button className={cls} disabled title="Waiting for them to answer">Requested</button>;
  async function go() {
    setBusy(true); setProblem(null);
    try {
      if (status === "incoming") await api.respond(person.id, true);
      else await api.request(person.username);
      await onChange?.();
    } catch (e) { setProblem(e.message); }
    setBusy(false);
  }
  return (
    <button className={cls} disabled={busy} onClick={go} title={problem || (status === "incoming" ? `${person.username} asked you: accept` : `Send ${person.username} a friend request`)} aria-label={`${status === "incoming" ? "Accept" : "Add"} ${person.username} as a friend`}>
      <UserPlus size={11} /> {problem ? "Try again" : busy ? "…" : status === "incoming" ? "Accept" : "Add"}
    </button>
  );
}
