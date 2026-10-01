// Admin -> AI usage: how much AI the game uses and how it goes. Totals,
// calls per day, by feature and by player, the commonest errors and
// refusals, and the call log itself: every AI, voice and picture-copy
// request with who, when, which feature, what was asked, the model, time,
// tokens and the outcome. Log filters live in the address
// (/admin/ai?status=error&task=Write%20a%20story&lp=2).
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "../../../lib/router";
import { useAppSettings } from "../../../lib/appSettings";
import { AI_PAGE } from "../adminApi";
import { pageWindow, DataTable } from "../DataTable";
import { BarList, ChartCard, ColumnChart, SimpleTable, formatNumber } from "../charts";
import { Badge, Kpi, Notice, fmtDate, longDay, relTime, shortDay, useAsync } from "../adminUi";

export const AI_STATUS = {
  ok: { label: "Worked", tone: "success" },
  error: { label: "Failed", tone: "danger" },
  denied: { label: "Refused", tone: "warning" },
  started: { label: "No answer", tone: "neutral" },
};
// Why the gate said no, in words.
export const DENIED_REASON = { admin: "Admin-only tool", off: "AI turned off for players", quota: "Daily limit reached", signin: "Not signed in" };
export const seconds = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const fullDate = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const reasonText = (r) => (r.status === "denied" ? DENIED_REASON[r.reason] || r.reason || "Refused" : r.reason || "");

export function AiUsagePage({ api, tick, usage, summary, activity, range, overview, players }) {
  const limit = useAppSettings().aiDailyLimit;
  const s = summary.data;
  const t = s?.totals || {};
  const perDay = (activity.data || []).map((r) => ({ key: r.day, label: shortDay(r.day), title: longDay(r.day), value: r.ai_calls || 0 }));
  const daysTotal = perDay.reduce((a, r) => a + r.value, 0);
  // Players: from the call log when there is one, else from the daily counts.
  const byPlayer = useMemo(() => {
    if (s?.by_user?.length) return s.by_user.map((u) => ({ key: u.username, label: u.username, value: u.calls }));
    const m = new Map();
    for (const r of usage.data || []) m.set(r.username, (m.get(r.username) || 0) + r.calls);
    return [...m].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value);
  }, [s, usage.data]);
  const byTask = (s?.by_task || []).map((x) => ({ ...x, key: `${x.task}|${x.kind}` }));
  const taskColumns = [
    { key: "task", label: "Feature", render: (r) => <span className="adm-word"><b>{r.task}</b><small>{r.kind === "tts" ? "voice" : "AI"}</small></span> },
    { key: "calls", label: "Calls", num: true, defaultDir: "desc" },
    { key: "ok", label: "Worked", num: true, render: (r) => `${r.ok} (${pct(r.ok, r.calls)})` },
    { key: "errors", label: "Failed", num: true, render: (r) => (r.errors ? <b className="adm-bad-text">{r.errors}</b> : 0) },
    { key: "denied", label: "Refused", num: true },
    { key: "avg_ms", label: "Avg time", num: true, render: (r) => seconds(r.avg_ms) },
    { key: "tokens", label: "Tokens", num: true, render: (r) => formatNumber(r.tokens) },
  ];
  const userColumns = [
    { key: "username", label: "Player" },
    { key: "calls", label: "Calls", num: true, defaultDir: "desc" },
    { key: "errors", label: "Failed", num: true },
    { key: "denied", label: "Refused", num: true },
    { key: "tokens", label: "Tokens", num: true, render: (r) => formatNumber(r.tokens) },
  ];

  return (
    <div className={`adm-section ${summary.loading || usage.loading ? "is-refreshing" : ""}`}>
      {(summary.error || usage.error) && <Notice tone="error">{summary.error || usage.error}</Notice>}
      <Notice>Players get {limit} AI calls a day (voice included); change it, or turn AI off for players, in Settings. The admin is unlimited. Every call is logged below with its feature and outcome.</Notice>
      <div className="adm-kpis compact">
        <Kpi label="Today" value={overview.data?.ai_calls_today ?? "—"} />
        <Kpi label={`Calls, ${range} days`} value={s ? t.calls : daysTotal} trend={perDay.map((r) => r.value)} sub={s && t.players ? `${t.players} player${t.players === 1 ? "" : "s"}` : ""} />
        <Kpi label="Worked" value={s && t.calls ? pct(t.ok, t.calls) : "—"} sub={s ? `${t.errors} failed · ${t.denied} refused${t.unfinished ? ` · ${t.unfinished} no answer` : ""}` : ""} tone={t.errors ? "attention" : ""} />
        <Kpi label="Response time" value={seconds(t.avg_ms)} sub={t.p95_ms ? `95% within ${seconds(t.p95_ms)}` : "average for calls that worked"} />
        <Kpi label="Tokens" value={formatNumber((t.input_tokens || 0) + (t.output_tokens || 0))} sub={s ? `${formatNumber(t.input_tokens || 0)} in · ${formatNumber(t.output_tokens || 0)} out` : ""} />
      </div>
      <div className="adm-grid two">
        <ChartCard title="AI calls per day" subtitle={`Last ${range} days`} table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Calls", num: true }]} rows={[...perDay].reverse()} />}>
          <ColumnChart data={perDay} valueLabel="calls" />
        </ChartCard>
        <ChartCard title="By feature" subtitle="What the calls were for" table={byTask.length ? <SimpleTable columns={[{ key: "task", label: "Feature" }, { key: "calls", label: "Calls", num: true }, { key: "errors", label: "Failed", num: true }]} rows={byTask} /> : null}>
          <BarList data={byTask.slice(0, 10).map((x) => ({ key: x.key, label: x.task, value: x.calls }))} valueLabel="calls" emptyText="No logged calls in this period yet." />
        </ChartCard>
      </div>
      {byTask.length > 0 && <article className="adm-card"><h3>Features</h3><DataTable id="ai-tasks" columns={taskColumns} rows={byTask} rowKey={(r) => r.key} csvName="word-hunter-ai-features" initialSort={{ key: "calls", dir: "desc" }} dense /></article>}
      <div className="adm-grid two">
        <ChartCard title="By player" subtitle={`Last ${range} days`} table={s?.by_user?.length ? <DataTable id="ai-users" columns={userColumns} rows={s.by_user} rowKey={(r) => r.username} csvName="word-hunter-ai-players" dense /> : null}>
          <BarList data={byPlayer.slice(0, 12)} valueLabel="calls" emptyText="No AI calls yet." />
        </ChartCard>
        <article className="adm-card">
          <h3>Errors and refusals</h3>
          {s?.by_reason?.length ? <ul className="adm-ai-reasons">
            {s.by_reason.map((r, i) => <li key={i}><Badge tone={AI_STATUS[r.status]?.tone}>{AI_STATUS[r.status]?.label}</Badge><span>{reasonText(r) || "No reason given"}</span><b>{r.calls}</b></li>)}
          </ul> : <p className="adm-muted">None in this period.</p>}
          {s?.by_model?.length > 0 && <><h3 className="adm-sub">Models</h3><ul className="adm-ai-reasons">{s.by_model.map((m) => <li key={m.model}><code>{m.model}</code><span>{seconds(m.avg_ms)} average</span><b>{m.calls}</b></li>)}</ul></>}
        </article>
      </div>
      <CallLog api={api} tick={tick} tasks={byTask.map((x) => x.task)} players={players} />
    </div>
  );
}

function CallLog({ api, tick, tasks, players }) {
  const [f, setF] = useQuery({ player: "", task: "", status: "", kind: "", from: "", to: "", lp: "1" });
  const page = Math.max(1, Number(f.lp) || 1);
  const userId = (players.data || []).find((p) => p.username === f.player)?.id || "";
  const unknownPlayer = f.player && players.data && !userId;
  const log = useAsync(() => (unknownPlayer ? { rows: [], count: 0 } : api.aiCalls({ page, userId, task: f.task, status: f.status, kind: f.kind, from: f.from, to: f.to })), [api, tick, page, userId, unknownPlayer, f.task, f.status, f.kind, f.from, f.to]);
  const [open, setOpen] = useState(() => new Set());
  const rows = log.data?.rows || [];
  const count = log.data?.count || 0;
  const pages = Math.max(1, Math.ceil(count / AI_PAGE));
  const set = (patch) => setF({ ...patch, lp: null });
  const filtered = f.player || f.task || f.status || f.kind || f.from || f.to;
  const toggle = (id) => setOpen((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const taskOptions = [...new Set([...tasks, f.task].filter(Boolean))].sort();

  return (
    <article className="adm-card adm-ai-log">
      <h3>Call log</h3>
      {!api.online && <Notice>The call log is kept on the server; it's empty in local mode.</Notice>}
      {log.error && <Notice tone="error">{log.error}</Notice>}
      <div className="adm-table-toolbar adm-audit-filters">
        <select className="adm-select" value={f.player} onChange={(e) => set({ player: e.target.value })} aria-label="Player"><option value="">Every player</option>{(players.data || []).map((p) => <option key={p.id} value={p.username}>{p.username}</option>)}</select>
        <select className="adm-select" value={f.task} onChange={(e) => set({ task: e.target.value })} aria-label="Feature"><option value="">Every feature</option>{taskOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select className="adm-select" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Outcome"><option value="">Any outcome</option>{Object.entries(AI_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className="adm-select" value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Kind"><option value="">AI and voice</option><option value="ai">AI only</option><option value="tts">Voice only</option></select>
        <label className="adm-date">From <input type="date" className="adm-select" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="adm-date">To <input type="date" className="adm-select" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {filtered && <button className="adm-link" onClick={() => setF({ player: null, task: null, status: null, kind: null, from: null, to: null, lp: null })}>Clear filters</button>}
      </div>
      <ol className="adm-audit">
        {rows.map((r) => {
          const st = AI_STATUS[r.status] || { label: r.status, tone: "neutral" };
          const isOpen = open.has(r.id);
          const tokens = (r.input_tokens || 0) + (r.output_tokens || 0);
          return (
            <li key={r.id} className={isOpen ? "open" : ""}>
              <button className="adm-audit-row adm-ai-row" onClick={() => toggle(r.id)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="adm-audit-when" title={fullDate(r.at)}>{fmtDate(r.at)}<small>{relTime(r.at)}</small></span>
                <span className="adm-audit-who"><i className="adm-avatar">{r.username.slice(0, 1).toUpperCase()}</i>{r.username}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
                <span className="adm-audit-item"><b>{r.task || (r.kind === "tts" ? "Pronunciation" : "Other")}</b><small>{r.kind === "tts" ? "voice" : "AI"}{r.admin_only ? " · admin tool" : ""}</small></span>
                <span className="adm-audit-sum">{r.status === "ok" ? `${seconds(r.ms)}${tokens ? ` · ${formatNumber(tokens)} tokens` : ""}${r.preview ? ` · ${r.preview}` : ""}` : reasonText(r) || r.preview || ""}</span>
              </button>
              {isOpen && <div className="adm-audit-detail">
                <dl className="adm-ai-detail">
                  <dt>When</dt><dd>{fullDate(r.at)}{r.finished_at && r.status !== "denied" ? ` · answered ${seconds(Date.parse(r.finished_at) - Date.parse(r.at))} later` : ""}</dd>
                  <dt>Player</dt><dd>{r.username}</dd>
                  <dt>Feature</dt><dd>{r.task || "—"} ({r.kind === "tts" ? "voice" : "AI"}{r.admin_only ? ", admin-only tool" : ""})</dd>
                  <dt>Outcome</dt><dd><Badge tone={st.tone}>{st.label}</Badge>{r.http_status ? ` HTTP ${r.http_status}` : ""}{reasonText(r) ? ` · ${reasonText(r)}` : ""}</dd>
                  {r.model && <><dt>Model</dt><dd><code>{r.model}</code></dd></>}
                  <dt>Time</dt><dd>{seconds(r.ms)}</dd>
                  <dt>Size</dt><dd>{r.prompt_chars != null ? `${formatNumber(r.prompt_chars)} characters sent` : "—"}{r.output_chars != null ? ` · ${formatNumber(r.output_chars)} ${r.kind === "tts" ? "bytes of audio" : "characters back"}` : ""}</dd>
                  <dt>Tokens</dt><dd>{r.input_tokens != null || r.output_tokens != null ? `${formatNumber(r.input_tokens || 0)} in · ${formatNumber(r.output_tokens || 0)} out` : "—"}</dd>
                  <dt>Asked</dt><dd><pre className="adm-diff-json">{r.preview || "—"}</pre></dd>
                </dl>
                {r.status === "started" && <p className="adm-muted">No result was recorded: the request may have timed out or the connection dropped before the answer.</p>}
              </div>}
            </li>
          );
        })}
        {!rows.length && !log.loading && <li className="adm-empty">{filtered ? "No calls match these filters." : "No AI calls logged yet. Every Ask AI, answer check, story, voice and admin AI tool call appears here."}</li>}
      </ol>
      <footer className="adm-pager">
        <span className="adm-pager-info">{count ? `${(page - 1) * AI_PAGE + 1}–${Math.min(count, page * AI_PAGE)} of ${count}` : "0"}</span>
        <nav className="adm-pager-nav" aria-label="Log pages">
          <button onClick={() => setF({ lp: page - 1 > 1 ? page - 1 : null }, { replace: false })} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
          {pageWindow(page, pages).map((p, i) => (p === "…" ? <span key={`e${i}`} className="adm-pager-gap">…</span> : <button key={p} className={p === page ? "on" : ""} aria-current={p === page ? "page" : undefined} onClick={() => setF({ lp: p > 1 ? p : null }, { replace: false })}>{p}</button>))}
          <button onClick={() => setF({ lp: page + 1 }, { replace: false })} disabled={page >= pages} aria-label="Next page"><ChevronRight size={15} /></button>
        </nav>
      </footer>
    </article>
  );
}
