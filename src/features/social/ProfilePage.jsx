import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { formatMs } from "../live/liveRules";
import { Award, Copy, Download, KeyRound, LogOut, SlidersHorizontal, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { isLocalMode } from "../../lib/supabase";
import { fetchLiveHistory } from "./socialApi";

export default function ProfilePage({ stats, onCopyBackup, onDownloadBackup, onOpenStats, onSignOut, learner = {}, settings, onOpen }) {
  const auth = useAuth();
  const [history, setHistory] = useState(null);
  const [historyError,setHistoryError]=useState(null);
  useEffect(() => {
    if (!auth.user || isLocalMode) { setHistory([]); return; }
    fetchLiveHistory(auth.user.id).then(setHistory).catch(e => {setHistory([]);setHistoryError(e.message);});
  }, [auth.user?.id]);

  const tiles = [
    ["Total XP", stats.score],
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
          <h2>{learner.displayName || auth.profile?.username}</h2>
          <p className="ui-muted">{auth.isAdmin ? "Admin" : "Player"}{isLocalMode ? " · local mode" : ""}</p>
        </div>
      </header>
      <div className="ui-tiles">{tiles.map(([label, value]) => <div key={label} className="ui-tile"><b>{value}</b><span>{label}</span></div>)}</div>
      <div className="ui-row-actions">
        <button className="ui-row-btn" onClick={()=>onOpen('account')}><KeyRound size={16}/> Account</button>
        <button className="ui-row-btn" onClick={()=>onOpen('badges')}><Award size={16}/> Achievements · {stats.badges}/{stats.badgesTotal}</button>
        <button className="ui-row-btn" onClick={()=>onOpen('onboarding')}><SlidersHorizontal size={16}/> Study goal · {learner.minutes || 10} min</button>
        <button className="ui-row-btn" onClick={onOpenStats}><Award size={16} /> Full stats &amp; weak words</button>
        <button className="ui-row-btn" onClick={() => navigate("/settings")}><SlidersHorizontal size={16} /> Settings</button>
      </div>

      <h3 className="ui-section-title"><Users size={16} /> Recent live matches</h3>
      {historyError && <p role="status">Could not load matches: {historyError}</p>}
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


    </section>
  );
}
