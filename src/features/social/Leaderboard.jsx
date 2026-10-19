import { useState } from "react";
import { Trophy } from "lucide-react";
import { isLocalMode } from "../../lib/supabase";
import { navigate } from "../../lib/router";
import { AddFriendButton, useFriendStatus } from "./AddFriendButton";
import { useLeaderboard } from "./useLeaderboard";
import { FIRST_RANK_TAB, RANK_TABS as TABS, emptyRanksText } from "./socialRules";

export default function Leaderboard({ me, hiddenForPlayers = false, friendsApi = null }) {
  const [tab, setTab] = useState(FIRST_RANK_TAB);
  const friends = useFriendStatus(friendsApi, !isLocalMode);
  const { rows, error } = useLeaderboard(tab, me, friendsApi);
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
      {rows && !rows.length && tab !== "friends" && <p className="ui-muted">{emptyRanksText(tab)}</p>}
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
