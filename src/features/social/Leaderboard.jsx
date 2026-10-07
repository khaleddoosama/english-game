import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { isLocalMode } from "../../lib/supabase";
import { navigate } from "../../lib/router";
import { weekStart } from "../../lib/repo";
import { fetchFriendsBoard, fetchLeaderboard } from "./socialApi";
import { AddFriendButton, useFriendStatus } from "./AddFriendButton";

// Practice points are counted by each player's game and sent with their
// progress; Live answers are checked by the server. Each tab says which.
const TABS = [
  { id: "friends", label: "Friends", value: (p) => (p.week_start === weekStart() ? p.week_score : 0), unit: "pts", extra: (p) => `${p.score} all time`, note: "You and your friends, by this week's practice points." },
  { id: "week", label: "This week", value: (p) => p.week_score, unit: "pts", note: "Practice points, counted by each player's game. For fun between friends; Live wins are checked by the server." },
  { id: "all", label: "All time", value: (p) => p.score, unit: "pts", note: "Practice points, counted by each player's game. For fun between friends; Live wins are checked by the server." },
  { id: "live", label: "Live wins", value: (p) => p.live_wins, unit: "wins", extra: (p) => `${p.live_played} played`, note: "Answers checked and timed by the server. A challenge's creator made its questions, so their own result doesn't count as a win." },
];

export default function Leaderboard({ me, hiddenForPlayers = false, friendsApi = null }) {
  const [tab, setTab] = useState("week");
  const friends = useFriendStatus(friendsApi, !isLocalMode);
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
  const t = TABS.find((x) => x.id === tab);
  return (
    <section className="ui-page">
      <header className="ui-page-head"><h2><Trophy size={20} /> Leaderboard</h2></header>
      <div className="ui-segmented" role="tablist">
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>)}
      </div>
      {isLocalMode && <p className="ui-muted">The leaderboard needs the online version.</p>}
      {hiddenForPlayers && <p className="ui-note">Ranks are hidden from players (Admin → Settings → Ranks). Only you can see this page.</p>}
      {error && <p className="wh-import-error">{error}</p>}
      {!rows && !error && !isLocalMode && <ol className="ui-rank-list">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="ui-skeleton-row" />)}</ol>}
      {rows && tab === "friends" && rows.length <= 1 && <p className="ui-muted">Add friends to compare your week with theirs. <button className="ui-row-btn" onClick={() => navigate("/friends")}>Find friends</button></p>}
      {rows && !rows.length && tab !== "friends" && <p className="ui-muted">{tab === "week" ? "No points yet this week — play a round to take first place." : tab === "live" ? "No live matches yet." : "Nobody has scored yet."}</p>}
      {!isLocalMode && <p className="ui-muted ui-rank-note">{t.note}</p>}
      {rows && rows.length > 0 && <ol className="ui-rank-list">
        {rows.map((p, i) => (
          <li key={p.id} className={p.id === me ? "is-me" : ""}>
            <span className={`ui-rank ${i < 3 ? `top-${i + 1}` : ""}`}>{i + 1}</span>
            <span className="ui-rank-name">{p.username}{p.id === me && <small> (you)</small>}{p.id !== me && tab !== "friends" && friendsApi && <AddFriendButton api={friendsApi} person={p} status={friends.statusOf(p.id)} onChange={friends.reload} />}<small className="ui-rank-sub">{p.mastered_count} mastered · {p.study_streak}d streak</small></span>
            <span className="ui-rank-value"><b>{t.value(p)}</b> {t.unit}{t.extra && <small>{t.extra(p)}</small>}</span>
          </li>
        ))}
      </ol>}
    </section>
  );
}
