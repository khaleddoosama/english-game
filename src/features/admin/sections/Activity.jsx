// Live matches and open challenges.
import { useMemo } from "react";
import { DataTable } from "../DataTable";
import { BarList, ChartCard, ColumnChart, SimpleTable } from "../charts";
import { Badge, Kpi, Notice, fmtDate, longDay, relTime, shortDay } from "../adminUi";

const dayRows = (activity, key) => (activity.data || []).map((r) => ({ key: r.day, label: shortDay(r.day), title: longDay(r.day), value: r[key] || 0 }));

const fmtTime = (ms) => (ms ? (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`) : "");
const STATE_TONE = { lobby: "warning", playing: "info", done: "neutral" };
const STATE_LABEL = { lobby: "waiting room", playing: "playing", done: "ended" };

// Challenges that haven't ended: who made them, how many joined/finished.
function OpenChallenges({ challenges, onEnd }) {
  const rows = (challenges.data || []).filter((c) => c.state !== "done" && Date.parse(c.expires_at) > Date.now());
  const columns = [
    { key: "created_at", label: "Created", defaultDir: "desc", sortValue: (r) => Date.parse(r.created_at), render: (r) => <span title={fmtDate(r.created_at)}>{relTime(r.created_at)}</span> },
    { key: "title", label: "Challenge", render: (r) => <span className="adm-word"><b>{r.title}</b><small><code>{r.code}</code> · by {r.host}</small></span> },
    { key: "state", label: "State", render: (r) => <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge> },
    { key: "start_mode", label: "Start", render: (r) => (r.start_mode === "anytime" ? "anytime" : "together") },
    { key: "players", label: "Players", num: true, render: (r) => `${r.players}/${r.max_players}` },
    { key: "finished", label: "Finished", num: true },
    { key: "question_count", label: "Questions", num: true, render: (r) => `${r.question_count}${r.seconds ? ` · ${r.seconds}s` : ""}` },
    { key: "expires_at", label: "Ends", sortValue: (r) => Date.parse(r.expires_at), render: (r) => <span title={fmtDate(r.expires_at)}>{relTime(r.expires_at)}</span> },
    { key: "act", label: "", sortable: false, csv: false, render: (r) => <span className="adm-tags"><a className="adm-btn ghost small" href={`/live/${r.code}`} target="_blank" rel="noreferrer">Open</a><button className="adm-btn ghost small" onClick={() => onEnd(r.code)}>End now</button></span> },
  ];
  if (!rows.length) return null;
  return <>
    <h3 className="adm-h3">Open challenges</h3>
    <DataTable id="live-open" columns={columns} rows={rows} rowKey={(r) => r.code} initialSort={{ key: "created_at", dir: "desc" }} emptyText="No open challenges." />
  </>;
}

export function LiveMatches({ matches, challenges = { data: [] }, activity, range, onEnd = () => {} }) {
  const rows = matches.data || [];
  const perDay = dayRows(activity, "live_matches");
  const wins = useMemo(() => {
    const m = new Map();
    for (const r of rows) { const w = r.results?.[0]; if (w && r.players > 1) m.set(w.username, (m.get(w.username) || 0) + 1); }
    return [...m].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [rows]);
  const columns = [
    { key: "played_at", label: "When", defaultDir: "desc", sortValue: (r) => Date.parse(r.played_at), csv: (r) => r.played_at, render: (r) => <span title={fmtDate(r.played_at)}>{relTime(r.played_at)}</span> },
    { key: "title", label: "Lesson" },
    { key: "room_code", label: "Room", render: (r) => <code>{r.room_code}</code> },
    { key: "players", label: "Players", num: true, defaultDir: "desc" },
    { key: "winner", label: "Winner", sortValue: (r) => r.results?.[0]?.username || "", csv: (r) => r.results?.[0]?.username || "", render: (r) => (r.players > 1 ? <b>🏆 {r.results?.[0]?.username}</b> : <span className="adm-muted">solo</span>) },
    { key: "results", label: "Results (right · time)", sortable: false, csv: (r) => (r.results || []).map((x) => `${x.rank}. ${x.username} ${x.correct}/${x.total} ${fmtTime(x.total_ms)}`).join(" | "), render: (r) => <span className="adm-tags">{(r.results || []).map((x) => <Badge key={x.username}>{x.rank}. {x.username} · {x.correct}/{x.total}{x.total_ms ? ` · ${fmtTime(x.total_ms)}` : ""}{x.finished === false ? " · unfinished" : ""}</Badge>)}</span> },
  ];
  return (
    <div className={`adm-section ${matches.loading ? "is-refreshing" : ""}`}>
      {matches.error && <Notice tone="error">{matches.error}</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Matches" value={rows.length} />
        <Kpi label={`Matches · ${range} days`} value={perDay.reduce((a, r) => a + r.value, 0)} trend={perDay.map((r) => r.value)} />
        <Kpi label="Avg. players" value={rows.length ? (rows.reduce((a, r) => a + r.players, 0) / rows.length).toFixed(1) : "—"} />
        <Kpi label="Different winners" value={wins.length} />
      </div>
      <div className="adm-grid two">
        <ChartCard title="Matches per day" subtitle={`Last ${range} days`} table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Matches", num: true }]} rows={[...perDay].reverse()} />}>
          <ColumnChart data={perDay} valueLabel="matches" />
        </ChartCard>
        <ChartCard title="Most wins" subtitle="Matches with 2+ players">
          <BarList data={wins} valueLabel="wins" emptyText="No multiplayer matches yet." />
        </ChartCard>
      </div>
      <OpenChallenges challenges={challenges} onEnd={onEnd} />
      <h3 className="adm-h3">Finished matches</h3>
      <DataTable id="live" syncUrl columns={columns} rows={rows} rowKey={(r) => `${r.room_code}-${r.played_at}`} csvName="word-hunter-live-matches"
        searchText={(r) => `${r.title} ${r.room_code} ${(r.results || []).map((x) => x.username).join(" ")}`} searchPlaceholder="Search lesson, room or player…"
        initialSort={{ key: "played_at", dir: "desc" }} emptyText="No live matches yet." />
    </div>
  );
}
