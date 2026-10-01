// Activity log: every change with who made it, when, to which item, and
// each changed field before and after. Filters and the page live in the
// address (/admin/audit?action=content.update&q=apple&page=2).
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronLeft, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useQuery } from "../../../lib/router";
import { AUDIT_PAGE } from "../adminApi";
import { pageWindow } from "../DataTable";
import { Badge, ConfirmDialog, Notice, fmtDate, relTime, useAsync } from "../adminUi";
import { DiffTable, changesToRows, fieldChanges } from "../diff";

export const ACTIONS = {
  "content.create": { label: "Added", tone: "success" },
  "content.update": { label: "Edited", tone: "info" },
  "content.delete": { label: "Deleted", tone: "danger" },
  "content.save": { label: "Save", tone: "neutral" },
  "content.rename": { label: "Renamed", tone: "info" },
  "categories.update": { label: "Categories", tone: "info" },
  "report.resolve": { label: "Report resolved", tone: "success" },
  "report.reopen": { label: "Report reopened", tone: "warning" },
  "report.update": { label: "Report edited", tone: "info" },
  "report.delete": { label: "Report deleted", tone: "danger" },
  "player.role": { label: "Role changed", tone: "warning" },
  "player.password": { label: "Password set", tone: "warning" },
  "player.reset": { label: "Progress reset", tone: "danger" },
  "player.delete": { label: "Account deleted", tone: "danger" },
  "live.end": { label: "Challenge ended", tone: "warning" },
  "settings.update": { label: "Settings", tone: "info" },
  "audit.delete": { label: "Log entries deleted", tone: "danger" },
  "audit.clear": { label: "Log cleared", tone: "danger" },
};
const FILTERS = [
  ["", "All changes"], ["content.*", "Content: all"], ["content.create", "Content added"], ["content.update", "Content edited"], ["content.rename", "Renamed"], ["content.delete", "Content deleted"],
  ["content.save", "Saves (batches)"], ["categories.update", "Category order"], ["report.*", "Reports"], ["player.*", "Players"], ["live.*", "Live challenges"], ["settings.update", "Settings"], ["audit.*", "Log clean-ups"],
];
const ENTITIES = [["", "Any type"], ["words", "Words"], ["grammar", "Grammar"], ["stories", "Stories"], ["combos", "Combos"], ["challenges", "Challenges"], ["report", "Reports"], ["player", "Players"], ["settings", "Settings"]];
const KEY_FIELD = { words: "word", grammar: "id", stories: "id", combos: "id", challenges: "id" };
const fullDate = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function summary(r) {
  if (r.action === "content.save") {
    const d = r.details || {};
    return `${d.changed ?? d.sent ?? 0} item change${(d.changed ?? d.sent) === 1 ? "" : "s"}${d.removed ? ` · ${d.removed} removed` : ""} · content version ${d.version ?? "—"}`;
  }
  if (r.changes && Object.keys(r.changes).length) {
    const fields = Object.keys(r.changes);
    return `${fields.length} field${fields.length === 1 ? "" : "s"} changed: ${fields.slice(0, 5).join(", ")}${fields.length > 5 ? "…" : ""}`;
  }
  if (r.after) return `${Object.keys(r.after).length} fields`;
  if (r.before) return "the item before deletion is kept below";
  return r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : "";
}

export function AuditLog({ api, tick, content, onUpdate, players, onOpenWord, onOpenReport, onOpenPlayer }) {
  const [f, setF] = useQuery({ action: "", entity: "", q: "", admin: "", from: "", to: "", batch: "", page: "1" });
  const page = Math.max(1, Number(f.page) || 1);
  const [search, setSearch] = useState(f.q);
  useEffect(() => { setSearch(f.q); }, [f.q]);
  useEffect(() => { const t = setTimeout(() => { if (search !== f.q) setF({ q: search, page: null }); }, 350); return () => clearTimeout(t); }, [search]);
  const admins = useMemo(() => (players.data || []).filter((p) => p.role === "admin"), [players.data]);
  const adminId = admins.find((a) => a.username === f.admin)?.id || "";
  const [n, setN] = useState(0);
  const log = useAsync(() => api.audit({ page, action: f.action, entity: f.entity, q: f.q, adminId, from: f.from, to: f.to, batch: f.batch }), [api, tick, n, page, f.action, f.entity, f.q, adminId, f.from, f.to, f.batch]);
  const [open, setOpen] = useState(() => new Set());
  const [revert, setRevert] = useState(null);
  const rows = log.data?.rows || [];
  const count = log.data?.count || 0;
  const pages = Math.max(1, Math.ceil(count / AUDIT_PAGE));
  const set = (patch) => setF({ ...patch, page: null });
  // Deleting: tick entries on this page, or everything (that matches).
  const [selected, setSelected] = useState(() => new Set());
  const [del, setDel] = useState(null); // { kind: "selected" | "matching" | "all", count }
  const [delBusy, setDelBusy] = useState(false);
  const [delDone, setDelDone] = useState(null);
  const filtered = !!(f.action || f.entity || f.q || f.admin || f.from || f.to || f.batch);
  useEffect(() => { setSelected(new Set()); }, [page, f.action, f.entity, f.q, f.admin, f.from, f.to, f.batch]);
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pick = (id) => setSelected((x) => { const next = new Set(x); next.has(id) ? next.delete(id) : next.add(id); return next; });
  async function runDelete() {
    setDelBusy(true);
    try {
      let n;
      if (del.kind === "selected") n = await api.deleteAudit([...selected]);
      else if (del.kind === "all") n = await api.clearAudit();
      else {
        const ids = await api.auditIds({ action: f.action, entity: f.entity, q: f.q, adminId, from: f.from, to: f.to, batch: f.batch });
        n = ids.length ? await api.deleteAudit(ids) : 0;
      }
      setDelDone({ tone: "info", text: `Deleted ${n} entr${n === 1 ? "y" : "ies"}. A note of the deletion was added to the log.` });
      setSelected(new Set());
      if (page > 1) setF({ page: null });
      setN((x) => x + 1);
    } catch (e) { setDelDone({ tone: "error", text: `Couldn't delete: ${e.message}` }); }
    setDelBusy(false); setDel(null);
  }
  const toggle = (id) => setOpen((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });

  // Undo a content change by applying its "before" values to the item as
  // it is now (or putting a deleted item back).
  function planRevert(r) {
    const field = KEY_FIELD[r.entity];
    if (r.entity === "categories" && r.changes?.level_order) return { r, describe: "Put the categories back in their earlier order.", apply: () => onUpdate("levels", (r.changes.level_order.before || []).map((title) => ({ id: `cat-${title}`, title }))) };
    if (!field) return null;
    const list = content[r.entity] || [];
    const at = list.findIndex((x) => String(x[field]).toLowerCase() === String(r.item_key).toLowerCase());
    if (r.action === "content.delete" && r.before) {
      if (at >= 0) return { r, describe: `“${r.item_key}” exists again already; restoring replaces it with the deleted version.`, apply: () => onUpdate(r.entity, list.map((x, i) => (i === at ? r.before : x))) };
      return { r, describe: `Put “${r.item_key}” back as it was when it was deleted.`, apply: () => onUpdate(r.entity, [...list, r.before]) };
    }
    if (r.action === "content.create") {
      if (at < 0) return null;
      return { r, describe: `Delete “${r.item_key}” again.`, apply: () => onUpdate(r.entity, list.filter((_, i) => i !== at)) };
    }
    if (r.action === "content.update" && r.changes && at >= 0) {
      const next = { ...list[at] };
      for (const [k, v] of Object.entries(r.changes)) { if (v.before === undefined || v.before === null) delete next[k]; else next[k] = v.before; }
      return { r, describe: `Set ${Object.keys(r.changes).join(", ")} on “${r.item_key}” back to the earlier values.`, rows: fieldChanges(list[at], next), apply: () => onUpdate(r.entity, list.map((x, i) => (i === at ? next : x))) };
    }
    return null;
  }

  function openItem(r) {
    if (KEY_FIELD[r.entity] === "word" && r.action !== "content.delete") return onOpenWord(r.item_key);
    if (r.entity === "report") return onOpenReport(r.item_key);
    if (r.entity === "player" && r.action !== "player.delete") return onOpenPlayer(r.item_key);
    if (r.entity === "live") return window.open(`/live/${r.item_key}`, "_blank");
    return null;
  }
  const linkable = (r) => (KEY_FIELD[r.entity] === "word" && r.action !== "content.delete") || r.entity === "report" || (r.entity === "player" && r.action !== "player.delete") || r.entity === "live";

  return (
    <div className={`adm-section ${log.loading ? "is-refreshing" : ""}`}>
      {!api.online && <Notice>The activity log is kept on the server; it's empty in local mode.</Notice>}
      {log.error && <Notice tone="error">{log.error}</Notice>}
      <div className="adm-table-toolbar adm-audit-filters">
        <label className="adm-search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item (word, rule, player…)" aria-label="Search item" /></label>
        <select className="adm-select" value={f.action} onChange={(e) => set({ action: e.target.value, batch: null })} aria-label="Change type">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="adm-select" value={f.entity} onChange={(e) => set({ entity: e.target.value })} aria-label="Item type">{ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {admins.length > 1 && <select className="adm-select" value={f.admin} onChange={(e) => set({ admin: e.target.value })} aria-label="Changed by"><option value="">Anyone</option>{admins.map((a) => <option key={a.id} value={a.username}>{a.username}</option>)}</select>}
        <label className="adm-date">From <input type="date" className="adm-select" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="adm-date">To <input type="date" className="adm-select" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {(f.action || f.entity || f.q || f.admin || f.from || f.to || f.batch) && <button className="adm-link" onClick={() => setF({ action: null, entity: null, q: null, admin: null, from: null, to: null, batch: null, page: null })}>Clear filters</button>}
      </div>
      {delDone && <Notice tone={delDone.tone}>{delDone.text}</Notice>}
      {api.online && count > 0 && <div className="adm-audit-bulk">
        <label className="adm-audit-pick"><input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(pageIds))} aria-label="Select every entry on this page" /> {selected.size ? `${selected.size} selected` : "Select"}</label>
        <button className="adm-btn danger small" disabled={!selected.size} onClick={() => setDel({ kind: "selected", count: selected.size })}><Trash2 size={14} /> Delete selected{selected.size ? ` (${selected.size})` : ""}</button>
        <span className="adm-toolbar-spacer" />
        <button className="adm-btn ghost small adm-danger-text" onClick={() => setDel({ kind: filtered ? "matching" : "all", count })}><Trash2 size={14} /> {filtered ? `Delete all ${count} that match` : "Delete all"}</button>
      </div>}
      {f.batch && <Notice>Showing the changes of one save. <button className="adm-link" onClick={() => set({ batch: null })}>Show everything</button></Notice>}
      <ol className="adm-audit">
        {rows.map((r) => {
          const meta = ACTIONS[r.action] || { label: r.action, tone: "neutral" };
          const isOpen = open.has(r.id);
          const plan = isOpen ? planRevert(r) : null;
          return (
            <li key={r.id} className={`${isOpen ? "open" : ""} ${selected.has(r.id) ? "picked" : ""}`}>
              <div className="adm-audit-line">
              {api.online && <input type="checkbox" className="adm-audit-check" checked={selected.has(r.id)} onChange={() => pick(r.id)} aria-label={`Select entry #${r.id}`} />}
              <button className="adm-audit-row" onClick={() => toggle(r.id)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="adm-audit-when" title={fullDate(r.at)}>{fmtDate(r.at)}<small>{relTime(r.at)}</small></span>
                <span className="adm-audit-who"><i className="adm-avatar">{(r.admin || "?").slice(0, 1).toUpperCase()}</i>{r.admin}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="adm-audit-item"><b>{r.item_key || r.target || (r.action === "content.save" ? "Content" : "—")}</b>{r.entity && r.entity !== "content" && <small>{r.entity}</small>}</span>
                <span className="adm-audit-sum">{summary(r)}</span>
              </button>
              </div>
              {isOpen && <div className="adm-audit-detail">
                <p className="adm-muted">{fullDate(r.at)} · by <b>{r.admin}</b>{r.target ? <> · {r.target}</> : null} · entry #{r.id}</p>
                {r.action === "content.save" ? <p><button className="adm-btn ghost small" onClick={() => setF({ batch: r.batch_id, action: "all", page: null })}>Show the {r.details?.changed ?? ""} item changes in this save</button></p>
                  : r.changes ? <DiffTable rows={changesToRows(r.changes)} />
                  : r.after ? <DiffTable mode="create" rows={Object.entries(r.after).map(([field, after]) => ({ field, after }))} />
                  : r.before ? <DiffTable mode="delete" rows={Object.entries(r.before).filter(([k]) => !k.startsWith("_")).map(([field, before]) => ({ field, before }))} />
                  : <pre className="adm-diff-json">{JSON.stringify(r.details, null, 2)}</pre>}
                <div className="adm-row">
                  {r.batch_id && r.action !== "content.save" && !f.batch && <button className="adm-link" onClick={() => setF({ batch: r.batch_id, action: "all", page: null })}>Same save</button>}
                  {linkable(r) && <button className="adm-btn ghost small" onClick={() => openItem(r)}><ExternalLink size={14} /> Open {r.entity === "report" ? "report" : r.entity === "player" ? "player" : r.entity === "live" ? "challenge" : "item"}</button>}
                  {plan && <button className="adm-btn ghost small" onClick={() => setRevert(plan)}><RotateCcw size={14} /> Revert</button>}
                </div>
              </div>}
            </li>
          );
        })}
        {!rows.length && !log.loading && <li className="adm-empty">{count === 0 && !f.action && !f.q ? "Nothing logged yet. Content edits, report actions and player changes appear here." : "No changes match these filters."}</li>}
      </ol>
      <footer className="adm-pager">
        <span className="adm-pager-info">{count ? `${(page - 1) * AUDIT_PAGE + 1}–${Math.min(count, page * AUDIT_PAGE)} of ${count}` : "0"}</span>
        <nav className="adm-pager-nav" aria-label="Pages">
          <button onClick={() => setF({ page: page - 1 > 1 ? page - 1 : null }, { replace: false })} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
          {pageWindow(page, pages).map((p, i) => (p === "…" ? <span key={`e${i}`} className="adm-pager-gap">…</span> : <button key={p} className={p === page ? "on" : ""} aria-current={p === page ? "page" : undefined} onClick={() => setF({ page: p > 1 ? p : null }, { replace: false })}>{p}</button>))}
          <button onClick={() => setF({ page: page + 1 }, { replace: false })} disabled={page >= pages} aria-label="Next page"><ChevronRight size={15} /></button>
        </nav>
      </footer>
      {del && <ConfirmDialog danger busy={delBusy} confirmLabel="Delete for good"
        title={del.kind === "selected" ? `Delete ${del.count} entr${del.count === 1 ? "y" : "ies"}?` : del.kind === "all" ? "Delete the whole activity log?" : `Delete all ${del.count} entries that match?`}
        confirmText={del.kind === "selected" && del.count <= 20 ? undefined : "DELETE"}
        body={<><p>{del.kind === "all" ? "Every entry goes, including the before-and-after values you'd need to revert a change." : "They're removed for good, including their before-and-after values, so those changes can't be reverted from here any more."}</p><p className="adm-muted">The game content itself isn't touched. One entry noting who deleted how many is added to the log.</p></>}
        onCancel={() => setDel(null)} onConfirm={runDelete} />}
      {revert && <ConfirmDialog title="Revert this change?" confirmLabel="Revert"
        body={<><p>{revert.describe}</p>{revert.rows && <DiffTable rows={revert.rows} />}<p className="adm-muted">The revert is saved like any edit and shows up in this log.</p></>}
        onCancel={() => setRevert(null)} onConfirm={() => { revert.apply(); setRevert(null); setTimeout(() => setN((x) => x + 1), 2500); }} />}
    </div>
  );
}
