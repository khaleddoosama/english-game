import { useMemo } from "react";
import { BarList, ChartCard, ColumnChart, LineChart, SimpleTable, StackedBar, formatNumber, formatPercent } from "../charts";
import { Kpi, Notice, longDay, shortDay } from "../adminUi";

// Class-wide word buckets (ordinal) from every player's attempts.
export function wordBuckets(words, stats) {
  const byKey = new Map(stats.map((s) => [s.item_key, s]));
  const b = { none: 0, low: 0, mid: 0, high: 0 };
  for (const w of words) {
    const s = byKey.get(w.word);
    if (!s || !s.attempts) b.none++;
    else { const acc = s.correct / s.attempts; if (acc < 0.5) b.low++; else if (acc < 0.8) b.mid++; else b.high++; }
  }
  return b;
}

export function Overview({ range, overview, activity, wordStats, players, content, onOpenWord, onOpenPlayer, onNavigate }) {
  const o = overview.data, act = activity.data || [], stats = wordStats.data || [];
  const sum = (k) => act.reduce((a, r) => a + (r[k] || 0), 0);
  const answers = sum("answers"), correct = sum("correct"), sessions = sum("sessions");
  const series = (k) => act.map((r) => r[k] || 0);
  const days = act.map((r) => ({ key: r.day, label: shortDay(r.day), title: longDay(r.day) }));
  const answersData = days.map((d, i) => ({ ...d, value: act[i].answers }));
  const accuracyData = days.map((d, i) => ({ ...d, value: act[i].answers ? act[i].correct / act[i].answers : null }));
  const activeData = days.map((d, i) => ({ ...d, value: act[i].active_players }));
  const buckets = useMemo(() => wordBuckets(content.words, stats), [content.words, stats]);
  const hardest = useMemo(() => {
    const known = new Set(content.words.map((w) => w.word));
    return stats.filter((s) => known.has(s.item_key) && s.attempts >= 5).map((s) => ({ key: s.item_key, label: s.item_key, value: 1 - s.correct / s.attempts, sub: `${s.attempts} answers · ${s.players} player${s.players === 1 ? "" : "s"}` }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
  }, [stats, content.words]);
  const categories = useMemo(() => {
    const m = new Map();
    for (const w of content.words) m.set(w.category || "Uncategorised", (m.get(w.category || "Uncategorised") || 0) + 1);
    return [...m].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value);
  }, [content.words]);
  const weekTop = (players.data || []).filter((p) => p.week_score > 0).sort((a, b) => b.week_score - a.week_score).slice(0, 8)
    .map((p) => ({ key: p.id, label: p.username, value: p.week_score, sub: `${p.mastered_count} mastered`, id: p.id }));

  const error = overview.error || activity.error;
  return (
    <div className={`adm-section ${overview.loading || activity.loading ? "is-refreshing" : ""}`}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="adm-kpis">
        <Kpi label="Players" value={o?.players ?? "—"} sub={o ? `+${o.new_7d} this week` : ""} />
        <Kpi label="Active · 7 days" value={o?.active_7d ?? "—"} sub={o ? `${o.active_1d} today · ${o.active_30d} in 30 days` : ""} />
        <Kpi label={`Answers · ${range} days`} value={answers} trend={series("answers")} />
        <Kpi label={`Accuracy · ${range} days`} value={answers ? formatPercent(correct / answers) : "—"} sub={`${formatNumber(correct)} right`} />
        <Kpi label={`Sessions · ${range} days`} value={sessions} trend={series("sessions")} />
        <Kpi label="Open reports" value={o?.open_reports ?? "—"} sub={o ? `${o.reports} filed in total` : ""} tone={o?.open_reports ? "attention" : ""} />
        <Kpi label="AI calls today" value={o?.ai_calls_today ?? "—"} sub={o ? `${o.ai_calls_7d} in 7 days` : ""} trend={series("ai_calls")} />
        <Kpi label="Live matches · 7 days" value={o?.live_matches_7d ?? "—"} sub={o ? `${o.live_matches} in total` : ""} />
      </div>

      <div className="adm-grid two">
        <ChartCard title="Answers per day" subtitle={`Questions answered by all players, last ${range} days`}
          table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Answers", num: true, format: formatNumber }]} rows={[...answersData].reverse()} />}>
          <ColumnChart data={answersData} valueLabel="answers" />
        </ChartCard>
        <ChartCard title="Accuracy per day" subtitle="Share of answers that were right (days without answers are gaps)"
          table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Accuracy", num: true, format: (v) => (v == null ? "—" : formatPercent(v)) }]} rows={[...accuracyData].reverse()} />}>
          <LineChart data={accuracyData} valueLabel="accuracy" format={formatPercent} yMax={1} />
        </ChartCard>
        <ChartCard title="Active players per day" subtitle="Players who finished at least one session"
          table={<SimpleTable columns={[{ key: "title", label: "Day" }, { key: "value", label: "Players", num: true }]} rows={[...activeData].reverse()} />}>
          <ColumnChart data={activeData} valueLabel="players" />
        </ChartCard>
        <ChartCard title="How the class does on each word" subtitle={`All ${formatNumber(content.words.length)} words, by every player's combined accuracy`}
          table={<SimpleTable columns={[{ key: "label", label: "Group" }, { key: "value", label: "Words", num: true }]} rows={[{ label: "Not practised yet", value: buckets.none }, { label: "Under 50% right", value: buckets.low }, { label: "50–79% right", value: buckets.mid }, { label: "80%+ right", value: buckets.high }]} />}>
          <StackedBar segments={[
            { label: "Not practised yet", value: buckets.none, cls: "neutral" },
            { label: "Under 50% right", value: buckets.low, cls: "ord-1" },
            { label: "50–79% right", value: buckets.mid, cls: "ord-2" },
            { label: "80%+ right", value: buckets.high, cls: "ord-4" },
          ]} />
        </ChartCard>
        <ChartCard title="Hardest words" subtitle="Highest share of wrong answers (5+ answers). Click a word to edit it."
          table={<SimpleTable columns={[{ key: "label", label: "Word" }, { key: "value", label: "Wrong", num: true, format: formatPercent }, { key: "sub", label: "Based on" }]} rows={hardest} />}>
          <BarList data={hardest} format={formatPercent} valueLabel="wrong" max={1} emptyText="Not enough answers yet." onSelect={(d) => onOpenWord(d.key)} />
        </ChartCard>
        <ChartCard title="Words per category" subtitle={`${categories.length} categories`}
          table={<SimpleTable columns={[{ key: "label", label: "Category" }, { key: "value", label: "Words", num: true }]} rows={categories} />}>
          <BarList data={categories.slice(0, 12)} valueLabel="words" />
          {categories.length > 12 && <button className="adm-link" onClick={() => onNavigate("content")}>All {categories.length} categories →</button>}
        </ChartCard>
        <ChartCard title="Top players this week" subtitle="Points earned since Monday. Click a player for details."
          table={<SimpleTable columns={[{ key: "label", label: "Player" }, { key: "value", label: "Points", num: true }, { key: "sub", label: "Mastered" }]} rows={weekTop} />}>
          <BarList data={weekTop} valueLabel="points" emptyText="No points yet this week." onSelect={(d) => onOpenPlayer(d.id)} />
        </ChartCard>
      </div>
    </div>
  );
}
