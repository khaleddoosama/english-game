import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { navigate } from "../../lib/router";
import { count } from "./components/format";
import "../../styles/library.css";

const REASONS = {
  not_found: "This link isn’t right. Ask your friend to send it again.",
  taken_back: "The sender took this link back.",
  expired: "This link has run out. Ask your friend for a new one.",
  removed: "The sender removed this view.",
};

// /join/<token>: what a friend shared by link, and a button to take your own copy.
export default function JoinPage({ api, token, onTaken }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    let alive = true;
    api.linkInfo(token).then((i) => alive && setInfo(i), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [api, token]);

  async function take() {
    setBusy(true); setError(null);
    try { const out = await api.linkAccept(token); setDone(out); onTaken?.(out); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="ui-page lib lib-join">
      <header className="ui-page-head"><h2><Link2 size={20} /> A view shared with you</h2></header>
      {error && <p className="lib-notice error" role="alert">{error}</p>}
      {!info && !error && <div className="ui-skeleton-row" />}
      {info && !info.valid && <p className="lib-notice error" role="alert">{REASONS[info.reason] || REASONS.not_found}</p>}
      {info?.valid && !done && (
        <div className="lib-inbox">
          <p><b>{info.from}</b> shared <b>“{info.name}”</b> with you.</p>
          <p className="ui-muted">{count(info.words, "word")}{info.rules ? ` · ${count(info.rules, "rule")}` : ""}{info.views > 1 ? ` · ${info.views} views` : ""}. You get your own copy, in your library.</p>
          {info.mine && <p className="ui-muted">This is your own view.</p>}
          {info.taken && <p className="ui-muted">You already have a copy of this one.</p>}
          <div className="lib-actions">
            <button className="ui-row-btn lib-primary" disabled={busy || info.mine} onClick={take}>{info.taken ? "Open my copy" : "Add to my library"}</button>
            <button className="ui-row-btn" onClick={() => navigate("/")}>Not now</button>
          </div>
        </div>
      )}
      {done && (
        <div className="lib-inbox">
          <p><b>{done.already ? "You already have this one." : `Added “${done.name}”.`}</b>{!done.already && ` ${count(done.words, "word")}${done.rules ? `, ${count(done.rules, "rule")}` : ""}${done.skipped ? ` (${done.skipped} private ${done.skipped === 1 ? "word was" : "words were"} not shared)` : ""}.`}</p>
          <div className="lib-actions">
            <button className="ui-row-btn lib-primary" onClick={() => onTaken?.(done, true)}>Open my views</button>
          </div>
        </div>
      )}
    </section>
  );
}
