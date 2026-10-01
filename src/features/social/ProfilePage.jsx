import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { formatMs } from "../live/liveRules";
import { Award, Copy, Download, KeyRound, LogOut, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { isLocalMode } from "../../lib/supabase";
import { fetchLiveHistory } from "./socialApi";

export default function ProfilePage({ stats, onCopyBackup, onDownloadBackup, onOpenStats }) {
  const auth = useAuth();
  const [history, setHistory] = useState(null);
  const [pw, setPw] = useState("");
  const [pwState, setPwState] = useState(null); // null | busy | done | error text
  useEffect(() => {
    if (!auth.user || isLocalMode) { setHistory([]); return; }
    fetchLiveHistory(auth.user.id).then(setHistory).catch(() => setHistory([]));
  }, [auth.user?.id]);

  async function changePassword(e) {
    e.preventDefault();
    setPwState("busy");
    try { await auth.changePassword(pw); setPw(""); setPwState("done"); }
    catch (problem) { setPwState(problem.message); }
  }

  const tiles = [
    ["Score", stats.score],
    ["Mastered", stats.mastered],
    ["Study streak", `${stats.studyStreak}d`],
    ["Best streak", `${stats.bestStudyStreak}d`],
    ["Answered", stats.attempted],
    ["Badges", `${stats.badges}/${stats.badgesTotal}`],
  ];
  return (
    <section className="ui-page">
      <header className="ui-profile-head">
        <div className="ui-avatar" aria-hidden="true">{(auth.profile?.username || "?").slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{auth.profile?.username}</h2>
          <p className="ui-muted">{auth.isAdmin ? "Admin" : "Player"}{isLocalMode ? " · local mode" : ""}</p>
        </div>
      </header>
      <div className="ui-tiles">{tiles.map(([label, value]) => <div key={label} className="ui-tile"><b>{value}</b><span>{label}</span></div>)}</div>
      <button className="ui-row-btn" onClick={onOpenStats}><Award size={16} /> Full stats &amp; weak words</button>

      <h3 className="ui-section-title"><Users size={16} /> Recent live matches</h3>
      {history === null ? <div className="ui-skeleton-row" /> : history.length === 0 ? <p className="ui-muted">No live matches yet. Create a challenge from the Live tab and send the link to your friends.</p> : (
        <ul className="ui-history">
          {history.map((h) => (
            <li key={`${h.room_code}-${h.played_at}`} onClick={() => navigate(`/live/${h.room_code}`)} role="link" tabIndex={0} className="clickable">
              <span><b>{h.rank === 1 && h.players > 1 ? "🏆 " : `#${h.rank} `}</b>{h.title}<small>{new Date(h.played_at).toLocaleDateString()} · {h.players} players</small></span>
              <span><b>{h.correct}/{h.total}</b> right<small>{h.total_ms ? formatMs(h.total_ms) : `${h.points} pts`}{h.finished === false ? " · unfinished" : ""}</small></span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="ui-section-title">Backup</h3>
      <p className="ui-muted">Your progress is saved to your account automatically. A backup file is an extra copy you keep.</p>
      <div className="ui-row-actions">
        <button className="ui-row-btn" onClick={onDownloadBackup}><Download size={16} /> Download backup</button>
        <button className="ui-row-btn" onClick={onCopyBackup}><Copy size={16} /> Copy backup</button>
      </div>

      {!isLocalMode && <>
        <h3 className="ui-section-title"><KeyRound size={16} /> Change password</h3>
        <form className="ui-inline-form" onSubmit={changePassword}>
          <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setPwState(null); }} minLength={6} placeholder="New password (6+ characters)" autoComplete="new-password" />
          <button className="ui-row-btn" disabled={pwState === "busy" || pw.length < 6}>{pwState === "busy" ? "Saving…" : "Save"}</button>
        </form>
        {pwState === "done" && <p className="ui-ok">Password changed.</p>}
        {pwState && !["busy", "done"].includes(pwState) && <p className="wh-import-error">{pwState}</p>}
        <button className="ui-row-btn ui-danger" onClick={() => auth.signOut()}><LogOut size={16} /> Sign out</button>
      </>}
    </section>
  );
}
