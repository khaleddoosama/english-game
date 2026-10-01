// Live matches, AI usage and the admin audit log.
import { useMemo, useState } from "react";
import { DataTable } from "../DataTable";
import { BarList, ChartCard, ColumnChart, SimpleTable, formatNumber } from "../charts";
import { Badge, Kpi, Notice, fmtDate, longDay, relTime, shortDay } from "../adminUi";

const dayRows = (activity, key) => (activity.data || []).map((r) => ({ key: r.day, label: shortDay(r.day), title: longDay(r.day), value: r[key] || 0 }));

export function LiveMatches({ matches, activity, range }) {
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
    { key: "results", label: "Results", sortable: false, csv: (r) => (r.results || []).map((x) => `${x.rank}. ${x.username} ${x.points}`).join(" | "), render: (r) => <span className="adm-tags">{(r.results || []).map((x) => <Badge key={x.username}>{x.rank}. {x.username} · {formatNumber(x.points)}</Badge>)}</span> },
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
      <DataTable id="live" columns={columns} rows={rows} rowKey={(r) => `${r.room_code}-${r.played_at}`} csvName="word-hunter-live-matches"
        searchText={(r) => `${r.title} ${r.room_code} ${(r.results || []).map((x) => x.username).join(" ")}`} searchPlaceholder="Search lesson, room or player…"
        initialSort={{ key: "played_at", dir: "desc" }} emptyText="No live matches yet." />
    </div>
  );
}

export function AiUsage({ usage, activity, range, overview }) {
  const rows = usage.data || [];
  const perDay = dayRows(activity, "ai_calls");
  const perPlayer = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.username, (m.get(r.username) || 0) + r.calls);
    return [...m].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);
  const columns = [
    { key: "day", label: "Day", defaultDir: "desc", render: (r) => longDay(r.day) },
    { key: "username", label: "Player" },
    { key: "calls", label: "AI calls", num: true, defaultDir: "desc" },
  ];
  const total = perDay.reduce((a, r) => a + r.value, 0);
  return (
    <div className={`adm-section ${usage.loading ? "is-refreshing" : ""}`}>
      {usage.error && <Notice tone="error">{usage.error}</Notice>}
      <Notice>Players get {150} AI calls a day (change with <code>PLAYER_DAILY_AI_CALLS</code> on Vercel). The admin is unlimited. Each call is one Gemini request.</Notice>
      <div className="adm-kpis compact">
        <Kpi label="Today" value={overview.data?.ai_calls_today ?? "—"} />
        <Kpi label={`${range} days`} value={total} trend={perDay.map((r) => r.value)} />
        <Kpi label="Per active day" value={perDay.filter((r) => r.value).length ? Math.round(total / perDay.filter((r) => r.value).length) : 0} />
        <Kpi label="Players using AI" value={perPlayer.length} />
      </div>
      <div className="adm-grid two">
        <ChartCard title="AI calls per day" subtitle={`Last ${range} days`} table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Calls", num: true }]} rows={[...perDay].reverse()} />}>
          <ColumnChart data={perDay} valueLabel="calls" />
        </ChartCard>
        <ChartCard title="By player" subtitle={`Last ${range} days`}>
          <BarList data={perPlayer.slice(0, 12)} valueLabel="calls" emptyText="No AI calls yet." />
        </ChartCard>
      </div>
      <DataTable id="ai" columns={columns} rows={rows} rowKey={(r) => `${r.day}-${r.username}`} csvName="word-hunter-ai-usage" searchText={(r) => r.username} searchPlaceholder="Search player…" initialSort={{ key: "day", dir: "desc" }} emptyText="No AI calls in this period." />
    </div>
  );
}

const ACTION_LABEL = { "content.save": "Content saved", "player.role": "Role changed", "player.password": "Password set", "player.reset": "Progress reset", "player.delete": "Account deleted" };
const ACTION_TONE = { "content.save": "info", "player.role": "warning", "player.password": "warning", "player.reset": "danger", "player.delete": "danger" };

export function AuditLog({ audit }) {
  const [action, setAction] = useState("");
  const rows = (audit.data || []).filter((r) => !action || r.action === action);
  const detail = (r) => {
    const d = r.details || {};
    if (r.action === "content.save") return `${d.changed || 0} changed, ${d.removed || 0} removed · v${d.version}${d.sample?.length ? ` · ${d.sample.join(", ")}${d.changed > d.sample.length ? "…" : ""}` : ""}`;
    if (r.action === "player.role") return `now ${d.role}`;
    return "";
  };
  const columns = [
    { key: "at", label: "When", defaultDir: "desc", sortValue: (r) => Date.parse(r.at), csv: (r) => r.at, render: (r) => <span title={fmtDate(r.at)}>{fmtDate(r.at)}</span> },
    { key: "admin", label: "By" },
    { key: "action", label: "Action", render: (r) => <Badge tone={ACTION_TONE[r.action] || "neutral"}>{ACTION_LABEL[r.action] || r.action}</Badge> },
    { key: "target", label: "Target", render: (r) => r.target || "—" },
    { key: "details", label: "Details", sortable: false, csv: detail, render: (r) => <span className="adm-muted">{detail(r)}</span> },
  ];
  return (
    <div className={`adm-section ${audit.loading ? "is-refreshing" : ""}`}>
      {audit.error && <Notice tone="error">{audit.error}</Notice>}
      <DataTable id="audit" columns={columns} rows={rows} rowKey={(r) => r.id} csvName="word-hunter-audit" searchText={(r) => `${r.action} ${r.target || ""} ${JSON.stringify(r.details)}`} searchPlaceholder="Search the log…"
        initialSort={{ key: "at", dir: "desc" }} resetKey={action}
        filters={<select className="adm-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
        emptyText="Nothing logged yet. Content saves and account changes appear here." />
    </div>
  );
}
