// Study Dashboard (/stats): where a player stands (stages, accuracy,
// streak, today's goal), the last two weeks, how each question type goes,
// the words that need work, mix-ups, and every level with its words.
// Level filter, search and the open level live in the address:
// /stats?show=started&q=fork&level=cat-Media
import { useMemo } from "react";
import { ArrowLeft, Award, CheckCircle2, ChevronDown, ChevronRight, Flame, Play, RotateCcw, Search, Star, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useQuery } from "../../lib/router";
import { LEVEL_FILTERS, STAGES, filterLevels, studyStats } from "./studyStats";
import "../../styles/stats.css";

const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const num = (n) => (Number(n) || 0).toLocaleString("en-US");
const dayLabel = (iso, opts) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);

export default function StudyDashboard({ levels, mastery, sessionLogs, dailyHistory, confusions, levelStats, studyStreak, bestStudyStreak, today, dailyGoal, weakReviewCount, onWeakReview, onPlayLevel, onBack }) {
  const s = useMemo(() => studyStats({ levels, mastery, sessionLogs, dailyHistory, confusions, levelStats }), [levels, mastery, sessionLogs, dailyHistory, confusions, levelStats]);
  const [query, setQuery] = useQuery({ show: "", q: "", level: "" });
  const shown = useMemo(() => filterLevels(s.levels, query.show, query.q), [s.levels, query.show, query.q]);
  const goalPct = Math.min(1, (today?.answered || 0) / Math.max(1, dailyGoal));
  const trend = s.week.prevAnswered ? s.week.answered - s.week.prevAnswered : null;
  const levelCount = s.levels.filter((l) => l.total > 0);

  return (
    <section className="sd" aria-labelledby="sd-title">
      <header className="sd-head">
        <button className="sd-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <h2 id="sd-title">Study dashboard</h2>
        <p>{num(s.items)} words, grammar rules and challenges across {levelCount.length} levels. You've practised {num(s.practised)} of them.</p>
      </header>

      <div className="sd-hero">
        <article className="sd-card sd-mastery">
          <Donut stages={s.stages} total={s.items} />
          <div className="sd-legend">
            {STAGES.map((st) => (
              <div key={st} className={`sd-legend-row ${st.toLowerCase()}`}>
                <i /><span>{st}</span><b>{num(s.stages[st])}</b><small>{s.items ? pct(s.stages[st] / s.items) : "—"}</small>
              </div>
            ))}
            {s.close > 0 && <p className="sd-note"><Award size={14} /> {s.close} close to mastery: a few more right answers.</p>}
          </div>
        </article>
        <div className="sd-kpis">
          <Kpi icon={<Target size={16} />} label="Accuracy" value={pct(s.accuracy)} sub={`${num(s.answers)} answers`} />
          <Kpi icon={<Flame size={16} />} label="Study streak" value={`${studyStreak || 0} day${studyStreak === 1 ? "" : "s"}`} sub={`Best: ${bestStudyStreak || 0}`} />
          <article className="sd-kpi">
            <span className="sd-kpi-label"><CheckCircle2 size={16} /> Today</span>
            <b>{today?.answered || 0}<small> / {dailyGoal}</small></b>
            <div className="sd-goal" role="progressbar" aria-label="Today's goal" aria-valuemin={0} aria-valuemax={dailyGoal} aria-valuenow={today?.answered || 0}><i style={{ width: `${goalPct * 100}%` }} /></div>
            <small>{goalPct >= 1 ? "Goal reached" : `${dailyGoal - (today?.answered || 0)} to go`}</small>
          </article>
          <Kpi icon={trend != null && trend < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />} label="Last 7 days" value={num(s.week.answered)}
            sub={s.week.prevAnswered ? `${num(s.week.prevAnswered)} the week before` : `${s.week.rounds} round${s.week.rounds === 1 ? "" : "s"}`} />
        </div>
      </div>

      <article className="sd-card">
        <div className="sd-card-head"><h3>Last 14 days</h3><small>{s.activeDays} active day{s.activeDays === 1 ? "" : "s"} · questions answered per day</small></div>
        <Activity days={s.activity} />
      </article>

      <div className="sd-grid">
        <article className="sd-card">
          <div className="sd-card-head"><h3>Needs work</h3>{weakReviewCount > 0 && <button className="sd-btn gold" onClick={onWeakReview}><RotateCcw size={14} /> Review {weakReviewCount}</button>}</div>
          {s.weak.length ? <ul className="sd-bars">
            {s.weak.map((w) => <li key={w.key}><span title={w.level}>{w.name}</span><Bar value={w.accuracy} tone="bad" /><small>{w.correct}/{w.total}</small></li>)}
          </ul> : <p className="sd-empty">No weak words right now. Words you get wrong more than a quarter of the time show up here.</p>}
        </article>
        <article className="sd-card">
          <div className="sd-card-head"><h3>By question type</h3><small>accuracy</small></div>
          {s.modes.length ? <ul className="sd-bars">
            {s.modes.slice(0, 8).map((m) => <li key={m.id}><span>{m.label}</span><Bar value={m.accuracy} tone={m.accuracy < 0.6 ? "bad" : m.accuracy < 0.8 ? "mid" : "good"} /><small>{pct(m.accuracy)}</small></li>)}
          </ul> : <p className="sd-empty">Play a round to see how each kind of question goes.</p>}
        </article>
        {s.mixups.length > 0 && <article className="sd-card">
          <div className="sd-card-head"><h3>Often mixed up</h3><small>times</small></div>
          <ul className="sd-mixups">{s.mixups.map((x) => <li key={x.pair.join("|")}><b>{x.pair[0]}</b><span>↔</span><b>{x.pair[1]}</b><small>{x.count}×</small></li>)}</ul>
        </article>}
      </div>

      <article className="sd-card sd-levels">
        <div className="sd-card-head"><h3>Levels</h3><small>{levelCount.filter((l) => l.status === "done").length} of {levelCount.length} fully mastered</small></div>
        <div className="sd-tools">
          <div className="sd-seg" role="radiogroup" aria-label="Show levels">
            {LEVEL_FILTERS.map((f) => <button key={f.id} role="radio" aria-checked={query.show === f.id} onClick={() => setQuery({ show: f.id })}>{f.label} <small>{f.id ? levelCount.filter((l) => l.status === f.id).length : levelCount.length}</small></button>)}
          </div>
          <label className="sd-search"><Search size={14} /><input value={query.q} onChange={(e) => setQuery({ q: e.target.value })} placeholder="Find a word or level" aria-label="Find a word or level" /></label>
        </div>
        {!shown.length && <p className="sd-empty">Nothing matches. {query.show || query.q ? <button className="sd-link" onClick={() => setQuery({ show: "", q: "" })}>Show all levels</button> : null}</p>}
        <ul className="sd-level-list">
          {shown.map((l) => {
            const open = query.level === l.id || (!!query.q && l.matches?.length > 0 && l.matches.length <= 12);
            const rows = query.q && l.matches?.length ? l.matches : l.items;
            return (
              <li key={l.id} className={`sd-level ${open ? "open" : ""}`}>
                <div className="sd-level-row">
                  <button className="sd-level-toggle" aria-expanded={open} onClick={() => setQuery({ level: query.level === l.id ? "" : l.id }, { replace: false })}>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="sd-level-title"><b>{l.title}</b><small>{l.stages.Mastered}/{l.total} mastered{l.practised ? ` · ${pct(l.accuracy)} right` : " · not started"}</small></span>
                  </button>
                  <Stacked stages={l.stages} total={l.total} />
                  <span className="sd-stars" aria-label={`${l.stars} of 3 stars`}>{[1, 2, 3].map((n) => <Star key={n} size={13} className={n <= l.stars ? "on" : ""} />)}</span>
                  <button className="sd-btn" onClick={() => onPlayLevel(l.index)} aria-label={`Practise ${l.title}`}><Play size={13} /> Practise</button>
                </div>
                {open && <table className="sd-items">
                  <thead><tr><th>{query.q ? "Matches" : "Item"}</th><th>Stage</th><th className="num">Right</th><th className="num">Accuracy</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.key}><td>{r.name}{r.kind !== "word" && <small className="sd-kind">{r.kind}</small>}</td><td><span className={`sd-stage ${r.stage.toLowerCase()}`}>{r.stage}</span></td><td className="num">{r.total ? `${r.correct}/${r.total}` : "—"}</td><td className="num">{pct(r.accuracy)}</td></tr>)}</tbody>
                </table>}
              </li>
            );
          })}
        </ul>
      </article>
    </section>
  );
}

function Kpi({ icon, label, value, sub }) {
  return <article className="sd-kpi"><span className="sd-kpi-label">{icon} {label}</span><b>{value}</b>{sub && <small>{sub}</small>}</article>;
}
function Bar({ value, tone = "good" }) {
  return <span className={`sd-bar ${tone}`}><i style={{ width: `${Math.max(2, Math.round((value || 0) * 100))}%` }} /></span>;
}
function Stacked({ stages, total }) {
  return (
    <span className="sd-stacked" title={STAGES.map((st) => `${st}: ${stages[st]}`).join(" · ")}>
      {total > 0 && STAGES.filter((st) => st !== "New").map((st) => <i key={st} className={st.toLowerCase()} style={{ width: `${(stages[st] / total) * 100}%` }} />)}
    </span>
  );
}
// Ring of the four stages, mastered first.
function Donut({ stages, total }) {
  const r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="sd-donut" aria-label={`${stages.Mastered} of ${total} mastered`}>
      <svg viewBox="0 0 128 128" width="148" height="148" role="img" aria-hidden="true">
        <circle cx="64" cy="64" r={r} className="sd-donut-track" />
        {total > 0 && STAGES.filter((st) => st !== "New" && stages[st] > 0).map((st) => {
          const len = (stages[st] / total) * c;
          const el = <circle key={st} cx="64" cy="64" r={r} className={`sd-donut-seg ${st.toLowerCase()}`} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <figcaption><b>{total ? Math.round((stages.Mastered / total) * 100) : 0}%</b><small>mastered</small></figcaption>
    </figure>
  );
}
function Activity({ days }) {
  const max = Math.max(1, ...days.map((d) => d.answered));
  if (!days.some((d) => d.answered)) return <p className="sd-empty">No rounds in the last two weeks. Finished rounds show up here.</p>;
  return (
    <div className="sd-activity" role="list">
      {days.map((d, i) => (
        <div key={d.day} role="listitem" className="sd-day" title={`${dayLabel(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${d.answered} answered, ${d.correct} right, ${d.rounds} round${d.rounds === 1 ? "" : "s"}`}>
          <span className="sd-day-bar"><i style={{ height: `${(d.answered / max) * 100}%` }} className={d.answered ? "" : "zero"}><em style={{ height: d.answered ? `${(d.correct / d.answered) * 100}%` : 0 }} /></i></span>
          <small>{i === days.length - 1 ? "Today" : dayLabel(d.day, { weekday: "narrow" })}</small>
        </div>
      ))}
    </div>
  );
}
