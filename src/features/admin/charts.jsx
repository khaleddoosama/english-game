// Small SVG chart kit for the admin panel. Follows the dataviz rules:
// thin marks (bars <= 24px, 4px rounded data-end, square at the baseline),
// 2px lines with a 10% area wash, hairline solid grid, one y-axis, text in
// ink tokens (never the series color), a hover/focus tooltip on every mark,
// and a table view for every chart. Colors come from CSS custom properties
// (--viz-*) set in admin.css and validated against the white card surface.
import { useEffect, useId, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------ helpers */

// "Nice" axis ticks: 0 .. max rounded up to 1/2/2.5/5 x 10^n steps.
export function niceTicks(max, count = 4, integer = false) {
  if (!(max > 0)) return [0, 1];
  const raw = integer ? Math.max(1, max / count) : max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).filter((s) => !integer || Number.isInteger(s)).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function formatCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${Math.round(v / 1e3)}K`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
export const formatNumber = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
export const formatPercent = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

// Path for a column/bar with a 4px rounded data-end and a square base.
function roundedTopRect(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function roundedRightRect(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

// Draw at the container's real width so text stays at its true size
// instead of shrinking with a scaled viewBox.
function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const next = Math.round(e.contentRect.width); if (next > 0) setW(next); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return Math.max(260, w);
}

function useTooltip() {
  const [tip, setTip] = useState(null); // { x, y, title, rows:[{label,value,key}] }
  return [tip, setTip];
}
function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.rows.map((r) => <div key={r.label} className="viz-tooltip-row"><b>{r.value}</b>{r.key && <i className={`viz-key ${r.key}`} />}<span>{r.label}</span></div>)}
      <div className="viz-tooltip-title">{tip.title}</div>
    </div>
  );
}

/* --------------------------------------------------------- chart card */

// Title + optional subtitle, a Chart/Table toggle (every chart has a table
// twin), and the chart itself.
export function ChartCard({ title, subtitle, table, children, actions, className = "" }) {
  const [view, setView] = useState("chart");
  return (
    <article className={`adm-card viz-card ${className}`}>
      <header className="viz-card-head">
        <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
        <div className="viz-card-actions">
          {actions}
          {table && <div className="adm-seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")}>Chart</button>
            <button role="tab" aria-selected={view === "table"} onClick={() => setView("table")}>Table</button>
          </div>}
        </div>
      </header>
      {view === "table" && table ? <div className="viz-table-wrap">{table}</div> : children}
    </article>
  );
}

export function SimpleTable({ columns, rows }) {
  return (
    <table className="viz-table">
      <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>)}</tr>)}</tbody>
    </table>
  );
}

/* --------------------------------------------------- column chart (time) */

// data: [{ key, label (x tick), title (tooltip heading), value }]
export function ColumnChart({ data, valueLabel = "Value", format = formatNumber, height = 200, emptyText = "No data in this period.", integer = true }) {
  const ref = useRef(null);
  const [tip, setTip] = useTooltip();
  const [hover, setHover] = useState(null);
  const W = useWidth(ref), H = height, padL = 40, padR = 8, padT = 12, padB = 26;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2)); // 2px surface gap between touching bars
  const y = (v) => padT + plotH - (v / top) * plotH;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(plotW / 64)));
  if (!data.length || max === 0) return <div className="viz-root" ref={ref}><div className="viz-empty">{emptyText}</div></div>;
  const show = (i, el) => {
    const d = data[i];
    const box = ref.current.getBoundingClientRect(), r = el.getBoundingClientRect();
    setHover(i);
    setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, title: d.title || d.label, rows: [{ label: valueLabel, value: format(d.value), key: "bar" }] });
  };
  return (
    <div className="viz-root" ref={ref} onPointerLeave={() => { setTip(null); setHover(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz-svg" role="img" aria-label={`${valueLabel} by day`}>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="viz-grid" /><text x={padL - 6} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{formatCompact(t)}</text></g>)}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="viz-axis" />
        {data.map((d, i) => {
          const x = padL + i * band + (band - barW) / 2;
          return (
            <g key={d.key}>
              <path d={roundedTopRect(x, y(d.value), barW, y(0) - y(d.value))} className={`viz-bar ${hover === i ? "is-hover" : ""}`} />
              {/* The hit target is the whole band, taller than the mark. */}
              <rect x={padL + i * band} y={padT} width={band} height={plotH} className="viz-hit" tabIndex={0} aria-label={`${d.title || d.label}: ${format(d.value)} ${valueLabel}`}
                onPointerMove={(e) => show(i, e.currentTarget.previousSibling)} onFocus={(e) => show(i, e.currentTarget.previousSibling)} onBlur={() => { setTip(null); setHover(null); }} />
              {i % every === 0 && <text x={padL + i * band + band / 2} y={H - 8} className="viz-tick" textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------ line / area chart */

// One series over time; crosshair snaps to the nearest day; value labelled at the end.
export function LineChart({ data, valueLabel = "Value", format = formatNumber, height = 200, emptyText = "No data in this period.", yMax, integer = false }) {
  const ref = useRef(null);
  const gid = useId().replace(/:/g, "");
  const [tip, setTip] = useTooltip();
  const [hover, setHover] = useState(null);
  const W = useWidth(ref), H = height, padL = 40, padR = 44, padT = 14, padB = 26;
  const max = yMax ?? Math.max(0, ...data.map((d) => d.value ?? 0));
  const ticks = yMax === 1 ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(max, 4, integer);
  const top = yMax ?? (ticks[ticks.length - 1] || 1);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (i) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => padT + plotH - (v / top) * plotH;
  const pts = data.map((d, i) => (d.value == null ? null : [x(i), y(d.value)]));
  const segs = [];
  let cur = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const every = Math.ceil(data.length / Math.max(2, Math.floor(plotW / 64)));
  if (!data.length || !pts.some(Boolean)) return <div className="viz-root" ref={ref}><div className="viz-empty">{emptyText}</div></div>;
  const lastIdx = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop();
  const move = (e) => {
    const box = ref.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - padL) / plotW) * (data.length - 1))));
    const d = data[i];
    setHover(i);
    setTip({ x: (x(i) / W) * box.width, y: ((d.value == null ? y(0) : y(d.value)) / H) * box.height, title: d.title || d.label, rows: [{ label: valueLabel, value: d.value == null ? "—" : format(d.value), key: "line" }] });
  };
  return (
    <div className="viz-root" ref={ref} onPointerMove={move} onPointerLeave={() => { setTip(null); setHover(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz-svg" role="img" aria-label={`${valueLabel} over time`} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          const i = Math.max(0, Math.min(data.length - 1, (hover ?? lastIdx) + (e.key === "ArrowRight" ? 1 : -1)));
          const d = data[i], box = ref.current.getBoundingClientRect();
          setHover(i); setTip({ x: (x(i) / W) * box.width, y: ((d.value == null ? y(0) : y(d.value)) / H) * box.height, title: d.title || d.label, rows: [{ label: valueLabel, value: d.value == null ? "—" : format(d.value), key: "line" }] });
        }}>
        <defs><linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="viz-area-stop" /><stop offset="1" className="viz-area-stop-end" /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="viz-grid" /><text x={padL - 6} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{format === formatPercent ? formatPercent(t) : formatCompact(t)}</text></g>)}
        {segs.map((s, k) => <path key={`a${k}`} d={`M${s[0][0]},${y(0)}${s.map((p) => `L${p[0]},${p[1]}`).join("")}L${s[s.length - 1][0]},${y(0)}Z`} fill={`url(#fill-${gid})`} />)}
        {segs.map((s, k) => <path key={`l${k}`} d={s.map((p, j) => `${j ? "L" : "M"}${p[0]},${p[1]}`).join("")} className="viz-line" />)}
        {segs.filter((s) => s.length === 1).map((s, k) => <circle key={`p${k}`} cx={s[0][0]} cy={s[0][1]} r={4} className="viz-dot" />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} className="viz-crosshair" />}
        {lastIdx != null && <><circle cx={pts[lastIdx][0]} cy={pts[lastIdx][1]} r={4} className="viz-dot" />
          <text x={pts[lastIdx][0] + 8} y={pts[lastIdx][1]} className="viz-endlabel" dominantBaseline="middle">{format(data[lastIdx].value)}</text></>}
        {hover != null && pts[hover] && <circle cx={pts[hover][0]} cy={pts[hover][1]} r={4} className="viz-dot" />}
        {data.map((d, i) => (i % every === 0 ? <text key={d.key} x={x(i)} y={H - 8} className="viz-tick" textAnchor="middle">{d.label}</text> : null))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* --------------------------------------------------- horizontal bar list */

// Ranked bars, one series: label left, value at the tip.
export function BarList({ data, format = formatNumber, valueLabel = "Value", max: maxIn, emptyText = "Nothing to show yet.", onSelect }) {
  const ref = useRef(null);
  const [tip, setTip] = useTooltip();
  if (!data.length) return <div className="viz-empty">{emptyText}</div>;
  const max = maxIn ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="viz-root viz-barlist" ref={ref} onPointerLeave={() => setTip(null)}>
      {data.map((d) => {
        const pct = Math.max(0, Math.min(1, d.value / max));
        const show = (e) => {
          const box = ref.current.getBoundingClientRect(), r = e.currentTarget.getBoundingClientRect();
          setTip({ x: r.left - box.left + Math.max(40, r.width * pct), y: r.top - box.top, title: d.label, rows: [{ label: valueLabel, value: format(d.value), key: "bar" }, ...(d.sub ? [{ label: d.sub, value: "" }] : [])] });
        };
        return (
          <button type="button" key={d.key || d.label} className="viz-barrow" onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} onClick={onSelect ? () => onSelect(d) : undefined} aria-label={`${d.label}: ${format(d.value)}`}>
            <span className="viz-barrow-label">{d.label}{d.sub && <small>{d.sub}</small>}</span>
            <span className="viz-barrow-track">
              <svg viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d={roundedRightRect(0, 0, pct * 100, 14, 2)} className="viz-bar" /></svg>
            </span>
            <span className="viz-barrow-value">{format(d.value)}</span>
          </button>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

/* -------------------------------------------- stacked 100% bar (ordinal) */

// Part-to-whole for ordered classes (New -> Mastered): one bar, 2px gaps,
// legend with values (always present for >= 2 classes).
export function StackedBar({ segments, format = formatNumber }) {
  const ref = useRef(null);
  const [tip, setTip] = useTooltip();
  const total = segments.reduce((s, x) => s + x.value, 0);
  const parts = useMemo(() => {
    let acc = 0;
    return segments.map((s) => { const start = acc; acc += s.value; return { ...s, start, share: total ? s.value / total : 0 }; });
  }, [segments, total]);
  const W = useWidth(ref);
  if (!total) return <div className="viz-root" ref={ref}><div className="viz-empty">Nothing to show yet.</div></div>;
  const H = 22, gap = 2;
  const visible = parts.filter((p) => p.value > 0);
  const avail = W - gap * (visible.length - 1);
  let cursor = 0;
  return (
    <div className="viz-root" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz-svg viz-stack" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
        {visible.map((p, i) => {
          const w = Math.max(1, p.share * avail);
          const x = cursor; cursor += w + gap;
          const first = i === 0, last = i === visible.length - 1, r = 4;
          const d = `M${x + (first ? r : 0)},0H${x + w - (last ? r : 0)}${last ? `Q${x + w},0 ${x + w},${r}V${H - r}Q${x + w},${H} ${x + w - r},${H}` : `V${H}`}H${x + (first ? r : 0)}${first ? `Q${x},${H} ${x},${H - r}V${r}Q${x},0 ${x + r},0` : `V0`}Z`;
          const show = (e) => { const box = ref.current.getBoundingClientRect(), rr = e.currentTarget.getBoundingClientRect(); setTip({ x: rr.left - box.left + rr.width / 2, y: rr.top - box.top, title: p.label, rows: [{ label: "words", value: `${format(p.value)} · ${formatPercent(p.share)}`, key: `stack ${p.cls}` }] }); };
          return <path key={p.label} d={d} className={`viz-seg ${p.cls}`} tabIndex={0} onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} aria-label={`${p.label}: ${format(p.value)}`} />;
        })}
      </svg>
      <ul className="viz-legend">
        {parts.map((p) => <li key={p.label}><i className={`viz-swatch ${p.cls}`} /><span>{p.label}</span><b>{format(p.value)}</b><small>{formatPercent(p.share)}</small></li>)}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ----------------------------------------------------------- sparkline */

export function Sparkline({ values, width = 96, height = 28 }) {
  if (!values?.length || values.every((v) => !v)) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join("");
  const lx = (values.length - 1) * step, ly = height - 2 - (values[values.length - 1] / max) * (height - 4);
  return <svg className="viz-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true"><path d={d} /><circle cx={lx} cy={ly} r={2.5} /></svg>;
}
