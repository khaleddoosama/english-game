import { useState } from "react";
import { Copy, Link2, Send } from "lucide-react";

// Share the open view: send it to friends (they get an offer), or make a link
// anyone signed in can open to take their own copy.
export default function SharePanel({ api, friendsApi, view, empty, busy, onSend }) {
  const [friends, setFriends] = useState(null);
  const [to, setTo] = useState(() => new Set());
  const [link, setLink] = useState(null);       // { token, uses } while it is good
  const [linkNote, setLinkNote] = useState(null);

  const open = async () => {
    if (friends || !friendsApi) return;
    try { setFriends((await friendsApi.list()).friends || []); } catch { setFriends([]); }
  };
  const toggle = (id) => setTo((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function send() {
    if ((await onSend([...to])) !== undefined) setTo(new Set());
  }
  const url = link ? `${window.location.origin}/join/${link.token}` : "";
  async function makeLink() {
    setLinkNote(null);
    try { setLink(await api.linkCreate(view.id)); } catch (e) { setLinkNote(e.message); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setLinkNote("Link copied."); }
    catch { setLinkNote("Select the link and copy it."); }
  }
  async function takeBack() {
    try { await api.linkRevoke(link.token); setLink(null); setLinkNote("The link no longer works."); } catch (e) { setLinkNote(e.message); }
  }

  return (
    <details className="lib-share" onToggle={(e) => e.currentTarget.open && open()}>
      <summary><Send size={14} /> Share</summary>
      <div className="lib-link-box">
        <h5><Link2 size={13} /> With a link</h5>
        {!link
          ? <button className="ui-row-btn" disabled={busy || empty} onClick={makeLink}>Get a link</button>
          : (
            <>
              <div className="lib-inline">
                <input readOnly value={url} aria-label="Link to this view" onFocus={(e) => e.target.select()} />
                <button className="ui-row-btn" onClick={copy}><Copy size={13} /> Copy</button>
                <button className="ui-row-btn" onClick={takeBack}>Take it back</button>
              </div>
              <p className="ui-muted">Anyone signed in who opens it gets their own copy in their library{link.uses ? ` · taken ${link.uses} ${link.uses === 1 ? "time" : "times"}` : ""}. It works for 30 days.</p>
            </>
          )}
        {linkNote && <p className="ui-muted" role="status">{linkNote}</p>}
      </div>
      {friendsApi && (
        <div className="lib-friend-box">
          <h5><Send size={13} /> To friends</h5>
          {friends === null ? <p className="ui-muted">Loading…</p> : !friends.length ? <p className="ui-muted">Add friends first, then you can send views to them.</p> : (
            <>
              <ul className="lib-friends">
                {friends.map((f) => <li key={f.id}><label><input type="checkbox" checked={to.has(f.id)} onChange={() => toggle(f.id)} /> {f.username}</label></li>)}
              </ul>
              <button className="ui-row-btn" disabled={busy || !to.size || empty} onClick={send}>Send “{view.name}”{to.size ? ` to ${to.size}` : ""}</button>
            </>
          )}
        </div>
      )}
      <p className="ui-muted">They get their own copy. Words only you made stay private.</p>
    </details>
  );
}
