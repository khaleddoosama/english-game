// One table component for every admin list: search, column sort, page
// size, pagination, row selection with bulk actions, and CSV export of the
// filtered rows. Data stays client-side (lists here are hundreds to a few
// thousand rows), so every control responds instantly.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Search, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

/* --------------------------------------------------------- pure helpers */

export function sortRows(rows, columns, sort) {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  const get = col.sortValue || ((r) => r[col.key]);
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // empties last either way
    if (y == null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
}

export function paginate(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, items: rows.slice((p - 1) * size, p * size), from: rows.length ? (p - 1) * size + 1 : 0, to: Math.min(rows.length, p * size) };
}

// Page buttons with ellipses: 1 … 4 5 [6] 7 8 … 20
export function pageWindow(page, pages, radius = 1) {
  const out = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= radius) out.push(i);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export function toCsv(rows, columns) {
  const cols = columns.filter((c) => c.csv !== false);
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => cell(c.csvLabel || c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(typeof c.csv === "function" ? c.csv(r) : c.sortValue ? c.sortValue(r) : r[c.key])).join(","));
  return [head, ...body].join("\r\n");
}

export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([type.startsWith("text/csv") ? "﻿" + text : text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PAGE_SIZES = [10, 25, 50, 100];
const sizeKey = (id) => `wh-admin-pagesize:${id}`;

/* ----------------------------------------------------------- component */

export function DataTable({
  id, columns, rows, rowKey, searchText, searchPlaceholder = "Search…", filters, toolbar,
  initialSort = null, selectable = false, bulkActions, onRowClick, emptyText = "Nothing here yet.", csvName,
  dense = false, resetKey,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem(sizeKey(id))) || 25; } catch { return 25; } });
  const [selected, setSelected] = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (searchText ? searchText(r) : JSON.stringify(r)).toLowerCase().includes(q));
  }, [rows, query, searchText]);
  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);
  const view = paginate(sorted, page, size);

  // New search/filter/data -> back to page 1; selection drops rows that left.
  useEffect(() => { setPage(1); }, [query, resetKey, size]);
  useEffect(() => {
    const keys = new Set(rows.map(rowKey));
    setSelected((s) => { const next = new Set([...s].filter((k) => keys.has(k))); return next.size === s.size ? s : next; });
  }, [rows]);

  const toggleSort = (col) => {
    if (col.sortable === false) return;
    setSort((s) => (!s || s.key !== col.key ? { key: col.key, dir: col.defaultDir || "asc" } : s.dir === "asc" ? { key: col.key, dir: "desc" } : s.dir === "desc" && !initialSort ? null : { key: col.key, dir: "asc" }));
  };
  const pageKeys = view.items.map(rowKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const selectedRows = sorted.filter((r) => selected.has(rowKey(r)));
  const setSizePersist = (n) => { setSize(n); try { localStorage.setItem(sizeKey(id), String(n)); } catch {} };

  return (
    <div className={`adm-table ${dense ? "dense" : ""}`}>
      <div className="adm-table-toolbar">
        <label className="adm-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
        </label>
        {filters}
        <div className="adm-toolbar-spacer" />
        {toolbar}
        {csvName && <button className="adm-btn ghost" onClick={() => downloadText(`${csvName}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(sorted, columns))}><Download size={15} /> CSV</button>}
      </div>
      {selectable && selected.size > 0 && (
        <div className="adm-bulkbar" role="region" aria-label="Bulk actions">
          <b>{selected.size} selected</b>
          {selected.size < sorted.length && <button className="adm-link" onClick={() => setSelected(new Set(sorted.map(rowKey)))}>Select all {sorted.length}</button>}
          <button className="adm-link" onClick={() => setSelected(new Set())}>Clear</button>
          <div className="adm-toolbar-spacer" />
          {bulkActions?.(selectedRows, () => setSelected(new Set()))}
        </div>
      )}
      <div className="adm-table-scroll">
        <table>
          <thead>
            <tr>
              {selectable && <th className="adm-check"><input type="checkbox" aria-label="Select this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); pageKeys.forEach((k) => (allOnPage ? n.delete(k) : n.add(k))); return n; })} /></th>}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th key={c.key} className={`${c.num ? "num" : ""} ${c.className || ""}`} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    {c.sortable === false ? c.label : <button className="adm-sort" onClick={() => toggleSort(c)}>{c.label}<Icon size={13} className={active ? "on" : ""} /></button>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.items.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} className={`${onRowClick ? "clickable" : ""} ${selected.has(k) ? "selected" : ""}`} onClick={onRowClick ? (e) => { if (!e.target.closest("button, input, a, select, label")) onRowClick(r); } : undefined}>
                  {selectable && <td className="adm-check"><input type="checkbox" aria-label="Select row" checked={selected.has(k)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} /></td>}
                  {columns.map((c) => <td key={c.key} className={`${c.num ? "num" : ""} ${c.className || ""}`}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
                </tr>
              );
            })}
            {!view.items.length && <tr><td className="adm-empty" colSpan={columns.length + (selectable ? 1 : 0)}>{rows.length ? "No rows match your search." : emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="adm-pager">
        <span className="adm-pager-info">{view.from}–{view.to} of {sorted.length}{sorted.length !== rows.length ? ` (filtered from ${rows.length})` : ""}</span>
        <label className="adm-pager-size">Rows <select value={size} onChange={(e) => setSizePersist(Number(e.target.value))}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <nav className="adm-pager-nav" aria-label="Pages">
          <button onClick={() => setPage(1)} disabled={view.page === 1} aria-label="First page"><ChevronsLeft size={15} /></button>
          <button onClick={() => setPage(view.page - 1)} disabled={view.page === 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
          {pageWindow(view.page, view.pages).map((p, i) => (p === "…" ? <span key={`e${i}`} className="adm-pager-gap">…</span> : <button key={p} className={p === view.page ? "on" : ""} aria-current={p === view.page ? "page" : undefined} onClick={() => setPage(p)}>{p}</button>))}
          <button onClick={() => setPage(view.page + 1)} disabled={view.page === view.pages} aria-label="Next page"><ChevronRight size={15} /></button>
          <button onClick={() => setPage(view.pages)} disabled={view.page === view.pages} aria-label="Last page"><ChevronsRight size={15} /></button>
        </nav>
      </footer>
    </div>
  );
}
