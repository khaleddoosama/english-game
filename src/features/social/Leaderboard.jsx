import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { isLocalMode } from "../../lib/supabase";
import { fetchLeaderboard } from "./socialApi";

const TABS = [
  { id: "week", label: "This week", value: (p) => p.week_score, unit: "pts" },
  { id: "all", label: "All time", value: (p) => p.score, unit: "pts" },
  { id: "live", label: "Live wins", value: (p) => p.live_wins, unit: "wins", extra: (p) => `${p.live_played} played` },
];

export default function Leaderboard({ me, hiddenForPlayers = false }) {
  const [tab, setTab] = useState("week");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let stale = false;
    setRows(null); setError(null);
    fetchLeaderboard(tab).then((r) => { if (!stale) setRows(r); }).catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [tab]);
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
      {rows && !rows.length && <p className="ui-muted">{tab === "week" ? "No points yet this week — play a round to take first place." : tab === "live" ? "No live matches yet." : "Nobody has scored yet."}</p>}
      {rows && rows.length > 0 && <ol className="ui-rank-list">
        {rows.map((p, i) => (
          <li key={p.id} className={p.id === me ? "is-me" : ""}>
            <span className={`ui-rank ${i < 3 ? `top-${i + 1}` : ""}`}>{i + 1}</span>
            <span className="ui-rank-name">{p.username}{p.id === me && <small> (you)</small>}<small className="ui-rank-sub">{p.mastered_count} mastered · {p.study_streak}d streak</small></span>
            <span className="ui-rank-value"><b>{t.value(p)}</b> {t.unit}{t.extra && <small>{t.extra(p)}</small>}</span>
          </li>
        ))}
      </ol>}
    </section>
  );
}
