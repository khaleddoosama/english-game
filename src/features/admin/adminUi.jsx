// Shared admin building blocks: data loading, KPI tiles, badges, drawer,
// confirm dialog, and the date-range control.
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Sparkline, formatCompact } from "./charts";

// Load data and keep the previous result on screen while refreshing
// (no skeleton flash on refetch).
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (id === seq.current) setState({ data, error: null, loading: false }); },
      (error) => { if (id === seq.current) setState((s) => ({ data: s.data, error: error?.message || String(error), loading: false })); },
    );
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function relTime(value) {
  if (!value) return "—";
  const t = typeof value === "number" ? value : Date.parse(value);
  if (!t) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
export const fmtDate = (value) => (value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
export const longDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function Kpi({ label, value, sub, trend, tone }) {
  return (
    <article className={`adm-kpi ${tone || ""}`}>
      <span className="adm-kpi-label">{label}</span>
      <b className="adm-kpi-value">{typeof value === "number" ? formatCompact(value) : value}</b>
      <div className="adm-kpi-foot">{sub && <small>{sub}</small>}{trend && <Sparkline values={trend} />}</div>
    </article>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`adm-badge ${tone}`}>{children}</span>;
}

export function Drawer({ title, subtitle, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="adm-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="adm-drawer-head">
          <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
          <div className="adm-drawer-actions">{actions}<button className="adm-icon" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        </header>
        <div className="adm-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

// confirmText: when set, the user must type it to enable the button.
export function ConfirmDialog({ title, body, confirmLabel = "Confirm", danger = false, confirmText, onConfirm, onCancel, busy }) {
  const [typed, setTyped] = useState("");
  const ok = !confirmText || typed.trim() === confirmText;
  return (
    <div className="adm-drawer-backdrop center" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="adm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="adm-dialog-body">{body}</div>
        {confirmText && <label className="adm-field"><span>Type <b>{confirmText}</b> to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>}
        <div className="adm-dialog-actions">
          <button className="adm-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`adm-btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={!ok || busy}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];
export function RangePicker({ value, onChange }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label="Date range">
      {RANGES.map((r) => <button key={r.days} role="radio" aria-checked={value === r.days} onClick={() => onChange(r.days)}>{r.label}</button>)}
    </div>
  );
}

export function Notice({ tone = "info", children }) {
  return <div className={`adm-notice ${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
