import { useState } from "react";
import { Send } from "lucide-react";

// Pick friends and send them the open view (they each get their own copy).
export default function SharePanel({ friendsApi, view, empty, busy, onSend }) {
  const [friends, setFriends] = useState(null);
  const [to, setTo] = useState(() => new Set());
  const open = async () => {
    if (friends) return;
    try { setFriends((await friendsApi.list()).friends || []); } catch { setFriends([]); }
  };
  const toggle = (id) => setTo((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function send() {
    if ((await onSend([...to])) !== undefined) setTo(new Set());
  }
  return (
    <details className="lib-share" onToggle={(e) => e.currentTarget.open && open()}>
      <summary><Send size={14} /> Share with friends</summary>
      {friends === null ? <p className="ui-muted">Loading…</p> : !friends.length ? <p className="ui-muted">Add friends first, then you can share views with them.</p> : (
        <>
          <ul className="lib-friends">
            {friends.map((f) => <li key={f.id}><label><input type="checkbox" checked={to.has(f.id)} onChange={() => toggle(f.id)} /> {f.username}</label></li>)}
          </ul>
          <button className="ui-row-btn" disabled={busy || !to.size || empty} onClick={send}>Send “{view.name}”{to.size ? ` to ${to.size}` : ""}</button>
          <p className="ui-muted">They get their own copy. Words only you made stay private.</p>
        </>
      )}
    </details>
  );
}
