// Data quality: the problems the analytics.data_issues view finds, word
// completeness, categories and question types, all from the analytics
// views (migration 0010). The same views can be queried in the Supabase
// SQL editor for deeper analysis.
import { useMemo } from "react";
import { useQuery } from "../../../lib/router";
import { DataTable } from "../DataTable";
import { BarList, ChartCard, SimpleTable, StackedBar, formatNumber } from "../charts";
import { Badge, Kpi, Notice, useAsync } from "../adminUi";

const SEV_TONE = { high: "danger", medium: "warning", low: "neutral" };
const SEV_RANK = { high: 0, medium: 1, low: 2 };
const VIEWS = [
  ["analytics.data_issues", "every problem: severity, area, item, issue, fix"],
  ["analytics.word_quality", "one row per word: missing fields, 0-100 score, accuracy, reports, last editor"],
  ["analytics.word_mode_accuracy", "accuracy of each question type for each word"],
  ["analytics.mode_accuracy", "accuracy per question type"],
  ["analytics.category_summary", "words, problems, pictures and accuracy per category"],
  ["analytics.player_summary", "one row per player: activity, accuracy, AI use, Live, reports"],
  ["analytics.report_details", "every report with question, answer, reason, reporter, status"],
  ["analytics.live_challenge_summary", "each challenge: players joined/started/finished, winner"],
  ["analytics.daily_activity", "last 90 days: players, sessions, answers, AI, reports, edits"],
  ["analytics.content_changes", "content edits per day and admin"],
];

export function DataQuality({ api, tick, onOpenWord, onOpenReport, onOpenPlayer, onNavigate }) {
  const issues = useAsync(() => api.dataIssues(), [api, tick]);
  const words = useAsync(() => api.analytics("word_quality"), [api, tick]);
  const categories = useAsync(() => api.analytics("category_summary"), [api, tick]);
  const modes = useAsync(() => api.analytics("mode_accuracy"), [api, tick]);
  const [f, setF] = useQuery({ severity: "", area: "" });
  const all = issues.data || [];
  const areas = useMemo(() => [...new Set(all.map((i) => i.area))].sort(), [all]);
  const rows = useMemo(() => all.filter((i) => (!f.severity || i.severity === f.severity) && (!f.area || i.area === f.area)).map((i, n) => ({ ...i, _k: `${i.area}|${i.item}|${i.issue}|${n}` })), [all, f.severity, f.area]);
  const count = (sev) => all.filter((i) => i.severity === sev).length;
  const byArea = areas.map((a) => ({ key: a, label: a, value: all.filter((i) => i.area === a).length })).sort((a, b) => b.value - a.value);
  const w = words.data || [];
  const avgScore = w.length ? Math.round(w.reduce((s, x) => s + Number(x.quality_score || 0), 0) / w.length) : null;
  const scoreBands = [
    { label: "Under 50", value: w.filter((x) => x.quality_score < 50).length, cls: "ord-1" },
    { label: "50–79", value: w.filter((x) => x.quality_score >= 50 && x.quality_score < 80).length, cls: "ord-2" },
    { label: "80–94", value: w.filter((x) => x.quality_score >= 80 && x.quality_score < 95).length, cls: "ord-3" },
    { label: "95–100", value: w.filter((x) => x.quality_score >= 95).length, cls: "ord-4" },
  ];
  const problemCounts = useMemo(() => {
    const m = new Map();
    for (const x of w) for (const p of x.problems || []) m.set(p, (m.get(p) || 0) + 1);
    return [...m].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value);
  }, [w]);
  const modeRows = (modes.data || []).filter((m) => m.attempts > 0).map((m) => ({ key: m.mode, label: m.mode, value: Number(m.accuracy_pct || 0), sub: `${formatNumber(m.attempts)} answers` })).sort((a, b) => a.value - b.value);

  function open(i) {
    if (i.area === "words") return onOpenWord(i.item);
    if (i.area === "reports") return onOpenReport(i.item);
    if (i.area === "players" || i.area === "progress") return onOpenPlayer(i.item);
    if (i.area === "grammar") return onNavigate("grammar");
    if (i.area === "live") return onNavigate("live");
    return null;
  }
  const columns = [
    { key: "severity", label: "Severity", sortValue: (i) => SEV_RANK[i.severity], render: (i) => <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge> },
    { key: "area", label: "Area" },
    { key: "item", label: "Item", render: (i) => <b>{i.item}</b> },
    { key: "issue", label: "Problem" },
    { key: "fix", label: "How to fix", render: (i) => <span className="adm-muted">{i.fix}</span> },
  ];

  return (
    <div className={`adm-section ${issues.loading ? "is-refreshing" : ""}`}>
      {(issues.error || words.error) && <Notice tone="error">{issues.error || words.error}</Notice>}
      {!api.online && <Notice>Local mode checks the words on this device only. Online, every check in the analytics views runs on the server.</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Problems" value={all.length} tone={count("high") ? "attention" : ""} sub={`${count("high")} high · ${count("medium")} medium · ${count("low")} low`} />
        <Kpi label="Word completeness" value={avgScore == null ? "—" : `${avgScore}/100`} sub="average score" />
        <Kpi label="Words missing content" value={w.filter((x) => (x.problems || []).some((p) => p !== "no picture")).length} sub={`of ${w.length}`} />
        <Kpi label="Without a picture" value={w.filter((x) => !x.has_picture).length} />
      </div>
      <div className="adm-grid two">
        <ChartCard title="Word completeness" subtitle="Score from meaning, example, gap, hints, picture and word links"
          table={<SimpleTable columns={[{ key: "label", label: "Score" }, { key: "value", label: "Words", num: true }]} rows={scoreBands} />}>
          <StackedBar segments={scoreBands} />
          <div className="adm-spacer" />
          <BarList data={problemCounts} valueLabel="words" emptyText="No word is missing anything." />
        </ChartCard>
        <ChartCard title="Problems by area" subtitle="From analytics.data_issues" table={<SimpleTable columns={[{ key: "label", label: "Area" }, { key: "value", label: "Problems", num: true }]} rows={byArea} />}>
          <BarList data={byArea} valueLabel="problems" emptyText="No problems found." onSelect={(d) => setF({ area: d.label, page: null })} />
        </ChartCard>
        <ChartCard title="Accuracy by question type" subtitle="Hardest first, all players" table={<SimpleTable columns={[{ key: "label", label: "Type" }, { key: "value", label: "Accuracy %", num: true }, { key: "sub", label: "Answers" }]} rows={modeRows} />}>
          <BarList data={modeRows} max={100} format={(v) => `${v}%`} valueLabel="accuracy" emptyText="No answers yet." />
        </ChartCard>
        <ChartCard title="Categories" subtitle="Words, problems and accuracy">
          <div className="viz-table-wrap"><SimpleTable columns={[{ key: "category", label: "Category" }, { key: "words", label: "Words", num: true }, { key: "words_with_problems", label: "With problems", num: true }, { key: "avg_quality", label: "Avg score", num: true }, { key: "accuracy_pct", label: "Accuracy %", num: true, format: (v) => (v == null ? "—" : v) }, { key: "open_reports", label: "Open reports", num: true }]} rows={categories.data || []} /></div>
        </ChartCard>
      </div>
      <h3 className="adm-h3">Problems to fix</h3>
      <DataTable id="issues" syncUrl columns={columns} rows={rows} rowKey={(i) => i._k} csvName="word-hunter-data-issues"
        searchText={(i) => `${i.item} ${i.issue} ${i.area}`} searchPlaceholder="Search problems…" initialSort={{ key: "severity", dir: "asc" }}
        resetKey={`${f.severity}|${f.area}`} onRowClick={open}
        filters={<>
          <select className="adm-select" value={f.severity} onChange={(e) => setF({ severity: e.target.value, page: null })} aria-label="Severity"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <select className="adm-select" value={f.area} onChange={(e) => setF({ area: e.target.value, page: null })} aria-label="Area"><option value="">Any area</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </>}
        emptyText="No problems found. Nice." />
      <details className="adm-sql-help">
        <summary>Query these views yourself (Supabase → SQL editor)</summary>
        <p>The checks above come from read-only views in the <code>analytics</code> schema. It isn't exposed to the app's API, so only you (in the SQL editor) and this admin page can read it.</p>
        <ul>{VIEWS.map(([name, desc]) => <li key={name}><code>{name}</code> — {desc}</li>)}</ul>
        <pre className="adm-diff-json">{`-- weakest words first
select word, category, quality_score, problems, accuracy_pct, open_reports
from analytics.word_quality order by quality_score, accuracy_pct nulls first limit 50;

-- question types players get wrong most
select * from analytics.mode_accuracy order by accuracy_pct;

-- players who stopped playing
select username, last_active, days_since_active, answers, accuracy_pct
from analytics.player_summary where days_since_active > 7 order by days_since_active desc;`}</pre>
      </details>
    </div>
  );
}
