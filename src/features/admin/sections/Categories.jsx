// Categories (= the game's lessons): order, rename, merge, add, delete,
// AI clean-up suggestions, and everything inside one category across all
// content types. /admin/categories/<name> opens one category.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eraser, FolderPlus, GitMerge, Pencil, Sparkles, Trash2 } from "lucide-react";
import { suggestCategoryMerges } from "../../../engine/ai";
import { DataTable } from "../DataTable";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice } from "../adminUi";

const TYPES = [["words", "Words", "word"], ["grammar", "Grammar", "id"], ["stories", "Stories", "id"], ["combos", "Combos", "id"], ["challenges", "Challenges", "id"]];

export function categoryRows(content) {
  const order = (content.levels || []).map((l) => l.title);
  const names = [...new Set([...order, ...TYPES.flatMap(([t]) => (content[t] || []).map((x) => x.category).filter(Boolean))])];
  return names.map((name) => {
    const counts = Object.fromEntries(TYPES.map(([t]) => [t, (content[t] || []).filter((x) => x.category === name).length]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const position = order.indexOf(name);
    return { name, position: position < 0 ? null : position + 1, listed: position >= 0, total, ...counts };
  }).sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.name.localeCompare(b.name));
}

export function Categories({ content, onUpdate, onMerge, onRemoveEmpty, openName, onOpen, onOpenWord, onNavigate }) {
  const rows = useMemo(() => categoryRows(content), [content]);
  const levels = content.levels || [];
  const [dialog, setDialog] = useState(null); // { kind, row }
  const [input, setInput] = useState("");
  const [ai, setAi] = useState(null); // { busy, error, merges, applied }
  const [note, setNote] = useState(null);
  const empty = rows.filter((r) => r.listed && !r.total);
  const unlisted = rows.filter((r) => !r.listed);

  const move = (row, dir) => {
    const at = levels.findIndex((l) => l.title === row.name), to = at + dir;
    if (at < 0 || to < 0 || to >= levels.length) return;
    const next = [...levels]; [next[at], next[to]] = [next[to], next[at]];
    onUpdate("levels", next);
  };
  function run() {
    const { kind, row } = dialog, name = input.trim();
    if (kind === "rename") {
      if (!name || name === row.name) return setDialog(null);
      if (rows.some((r) => r.name === name)) { onMerge(name, [row.name]); setNote(`“${row.name}” was merged into the existing “${name}”.`); }
      else if (row.listed) onUpdate("levels", levels.map((l) => (l.title === row.name ? { ...l, title: name } : l)));
      else onMerge(name, [row.name]);
      if (openName === row.name) onOpen(name);
    }
    if (kind === "merge" && name && name !== row.name) { onMerge(name, [row.name]); setNote(`Moved ${row.total} item${row.total === 1 ? "" : "s"} from “${row.name}” to “${name}”.`); if (openName === row.name) onOpen(name); }
    if (kind === "add" && name && !rows.some((r) => r.name === name)) onUpdate("levels", [...levels, { id: `cat-${name}`, title: name }]);
    if (kind === "list") onUpdate("levels", [...levels, { id: `cat-${row.name}`, title: row.name }]);
    if (kind === "delete") { onUpdate("levels", levels.filter((l) => l.title !== row.name)); if (openName === row.name) onOpen(null); }
    setDialog(null); setInput("");
  }
  async function suggest() {
    setAi({ busy: true });
    try { setAi({ merges: await suggestCategoryMerges(rows.map((r) => r.name)), applied: [] }); }
    catch (e) { setAi({ error: e.message || "AI couldn't look at the categories." }); }
  }

  const columns = [
    { key: "position", label: "#", num: true, width: 52, render: (r) => r.position ?? <Badge tone="warning">—</Badge> },
    { key: "name", label: "Category", render: (r) => <span className="adm-word"><b>{r.name}</b>{!r.listed && <small className="adm-warn-text">not in the level list: its content doesn't appear in the game</small>}{r.listed && !r.total && <small className="adm-muted">empty</small>}</span> },
    ...TYPES.map(([t, label]) => ({ key: t, label, num: true, defaultDir: "desc", render: (r) => r[t] || <span className="adm-muted">0</span> })),
    { key: "act", label: "", sortable: false, csv: false, render: (r) => (
      <span className="adm-row-actions">
        {r.listed && <><button className="adm-icon" title="Move up" aria-label={`Move ${r.name} up`} disabled={r.position === 1} onClick={() => move(r, -1)}><ArrowUp size={15} /></button>
        <button className="adm-icon" title="Move down" aria-label={`Move ${r.name} down`} disabled={r.position === levels.length} onClick={() => move(r, 1)}><ArrowDown size={15} /></button></>}
        {!r.listed && <button className="adm-btn ghost small" onClick={() => setDialog({ kind: "list", row: r })}>Add to list</button>}
        <button className="adm-icon" title="Rename" aria-label={`Rename ${r.name}`} onClick={() => { setDialog({ kind: "rename", row: r }); setInput(r.name); }}><Pencil size={15} /></button>
        <button className="adm-icon" title="Merge into another category" aria-label={`Merge ${r.name}`} disabled={!r.total} onClick={() => { setDialog({ kind: "merge", row: r }); setInput(""); }}><GitMerge size={15} /></button>
        {r.listed && <button className="adm-icon danger" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => setDialog({ kind: "delete", row: r })}><Trash2 size={15} /></button>}
      </span>
    ) },
  ];
  const open = openName ? rows.find((r) => r.name === openName) : null;

  return (
    <div className="adm-section">
      {note && <Notice>{note}</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Categories" value={rows.filter((r) => r.listed).length} sub="in the level list" />
        <Kpi label="Empty" value={empty.length} />
        <Kpi label="Not listed" value={unlisted.length} tone={unlisted.length ? "attention" : ""} sub="content that doesn't show" />
        <Kpi label="Items" value={rows.reduce((a, r) => a + r.total, 0)} />
      </div>
      {ai?.error && <Notice tone="error">{ai.error}</Notice>}
      {ai?.merges && <div className="adm-card adm-ai-merges">
        <h3><Sparkles size={15} /> AI clean-up suggestions</h3>
        {!ai.merges.length ? <p className="adm-muted">No confident duplicates found.</p> : ai.merges.map((m) => (
          <div key={m.canonical} className="adm-merge-row">
            <span><b>{m.canonical}</b> <small className="adm-muted">absorbs {m.duplicates.join(", ")}</small></span>
            {ai.applied.includes(m.canonical) ? <Badge tone="success">merged</Badge> : <button className="adm-btn primary small" onClick={() => { onMerge(m.canonical, m.duplicates); setAi((a) => ({ ...a, applied: [...a.applied, m.canonical] })); }}><GitMerge size={14} /> Merge</button>}
          </div>
        ))}
        <button className="adm-link" onClick={() => setAi(null)}>Close</button>
      </div>}
      <DataTable id="categories" syncUrl columns={columns} rows={rows} rowKey={(r) => r.name} csvName="word-hunter-categories" searchText={(r) => r.name}
        searchPlaceholder="Search categories…" initialSort={{ key: "position", dir: "asc" }} onRowClick={(r) => onOpen(r.name)}
        toolbar={<>
          <button className="adm-btn ghost" disabled={ai?.busy} onClick={suggest}><Sparkles size={15} /> {ai?.busy ? "Asking AI…" : "Suggest clean-up"}</button>
          {empty.length > 0 && <button className="adm-btn ghost" onClick={() => setNote(`Removed ${onRemoveEmpty()} empty categor${empty.length === 1 ? "y" : "ies"}.`)}><Eraser size={15} /> Remove {empty.length} empty</button>}
          <button className="adm-btn primary" onClick={() => { setDialog({ kind: "add" }); setInput(""); }}><FolderPlus size={15} /> New category</button>
        </>} />
      {open && <CategoryDrawer row={open} content={content} onClose={() => onOpen(null)} onOpenWord={onOpenWord} onNavigate={onNavigate}
        onMoveAll={(row) => { setDialog({ kind: "merge", row }); setInput(""); }} />}
      {dialog && dialog.kind !== "delete" && dialog.kind !== "list" && <ConfirmDialog
        title={dialog.kind === "add" ? "New category" : dialog.kind === "rename" ? `Rename “${dialog.row.name}”` : `Move everything in “${dialog.row.name}”`}
        confirmLabel={dialog.kind === "add" ? "Add" : dialog.kind === "rename" ? "Rename" : "Move"}
        body={<label className="adm-field"><span>{dialog.kind === "merge" ? `Into which category? Its ${dialog.row.total} items move there, and “${dialog.row.name}” goes away.` : "Name"}</span>
          <input className="adm-input" autoFocus list="adm-cat-names" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
          <datalist id="adm-cat-names">{rows.filter((r) => r.name !== dialog.row?.name).map((r) => <option key={r.name} value={r.name} />)}</datalist>
          {dialog.kind === "rename" && <small className="adm-muted">Words, grammar and stories move with it. Typing an existing name merges the two.</small>}</label>}
        onCancel={() => setDialog(null)} onConfirm={run} />}
      {dialog?.kind === "list" && <ConfirmDialog title={`Add “${dialog.row.name}” to the level list?`} confirmLabel="Add" body={<p>Its {dialog.row.total} items start showing in the game as a new lesson at the end.</p>} onCancel={() => setDialog(null)} onConfirm={run} />}
      {dialog?.kind === "delete" && <ConfirmDialog danger title={`Delete “${dialog.row.name}”?`} confirmLabel={dialog.row.total ? `Delete it and its ${dialog.row.total} items` : "Delete"} confirmText={dialog.row.total ? "DELETE" : undefined}
        body={dialog.row.total ? <><p>This also deletes the {dialog.row.total} words, grammar rules, stories and challenges in it, for every player.</p><p>To keep them, use <b>Merge</b> instead and move them to another category.</p></> : <p>The category is empty.</p>}
        onCancel={() => setDialog(null)} onConfirm={run} />}
    </div>
  );
}

function CategoryDrawer({ row, content, onClose, onOpenWord, onNavigate, onMoveAll }) {
  return (
    <Drawer title={row.name} subtitle={`${row.total} item${row.total === 1 ? "" : "s"}${row.position ? ` · lesson ${row.position}` : " · not in the level list"}`} onClose={onClose}
      actions={row.total > 0 && <button className="adm-btn ghost small" onClick={() => onMoveAll(row)}><GitMerge size={14} /> Move all…</button>}>
      {!row.total && <p className="adm-muted">Nothing in this category yet.</p>}
      {TYPES.map(([t, label, key]) => {
        const items = (content[t] || []).filter((x) => x.category === row.name);
        if (!items.length) return null;
        return (
          <section key={t} className="adm-cat-group">
            <h4>{label} <Badge>{items.length}</Badge></h4>
            <ul>
              {items.slice(0, 300).map((x) => (
                <li key={x[key]}>
                  <button className="adm-link" onClick={() => (t === "words" ? onOpenWord(x.word) : t === "grammar" ? onNavigate("grammar", x.id) : onNavigate("library", x.id, t))}>{x[key]}</button>
                  <small className="adm-muted">{x.meaning || x.rule || x.title || x.label || ""}</small>
                </li>
              ))}
            </ul>
            {items.length > 300 && <p className="adm-muted">…and {items.length - 300} more.</p>}
          </section>
        );
      })}
    </Drawer>
  );
}
