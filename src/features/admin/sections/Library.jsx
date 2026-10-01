// Stories, combos and challenges: list, search, edit (title and category
// as fields, everything else as JSON), add, duplicate, move, delete.
// /admin/library?type=stories, /admin/library/<id>?type=stories
import { useMemo, useState } from "react";
import { Copy, FolderInput, Plus, Trash2 } from "lucide-react";
import { useQueryParam } from "../../../lib/router";
import { V2 } from "../../../engine/v2";
import { DataTable } from "../DataTable";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice } from "../adminUi";
import { sameItem } from "../editors/WordEditor";

export const LIBRARY_TYPES = {
  stories: { label: "Stories", one: "story", title: (x) => x.title, size: (x) => `${(x.questions || []).length} questions · ${(x.targetWords || []).length} words`, blank: (id, category) => ({ id, title: "New story", category, text: "", targetWords: [], questions: [] }) },
  combos: { label: "Combos", one: "combo", title: (x) => x.title || x.prompt || x.label, size: (x) => `${(x.words || x.targetWords || []).length} words`, blank: (id, category) => ({ id, category, title: "New combo", words: [] }) },
  challenges: { label: "Challenges", one: "challenge", title: (x) => x.label || x.title || x.prompt, size: (x) => `${(x.steps || x.questions || []).length} steps`, blank: (id, category) => ({ id, category, label: "New challenge", steps: [] }) },
};
const ARABIC = /[؀-ۿ]/;

export function libraryProblems(type, item, list, original, content) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return ["The item must be a JSON object."];
  const out = [];
  if (!String(item.id || "").trim()) out.push("Every item needs an id.");
  else if (list.some((x) => x !== original && V2.norm(x.id) === V2.norm(item.id))) out.push(`Another ${LIBRARY_TYPES[type].one} already uses the id “${item.id}”.`);
  if (ARABIC.test(JSON.stringify(item))) out.push("Game content must be in English only (no Arabic).");
  if (!out.length) out.push(...V2.validateContent({ schemaVersion: 2, kind: "content", [type]: [item] }, content).slice(0, 5));
  return out;
}

export function Library({ content, onUpdate, openId, onOpen }) {
  const [typeParam, setType] = useQueryParam("type", "stories");
  const type = LIBRARY_TYPES[typeParam] ? typeParam : "stories";
  const T = LIBRARY_TYPES[type];
  const list = content[type] || [];
  const categories = useMemo(() => (content.levels || []).map((l) => l.title), [content.levels]);
  const [confirm, setConfirm] = useState(null);
  const [moveTo, setMoveTo] = useState(null);
  const [moveInput, setMoveInput] = useState("");
  const rows = useMemo(() => list.map((x, i) => ({ x, i, id: x.id, title: T.title(x) || "", category: x.category || "", size: T.size(x), missing: !!x.category && !categories.includes(x.category) })), [list, T, categories]);
  const columns = [
    { key: "id", label: "Id", render: (r) => <code>{r.id}</code> },
    { key: "title", label: "Title", render: (r) => <b>{r.title || <span className="adm-muted">—</span>}</b> },
    { key: "category", label: "Category", render: (r) => <span>{r.category || <span className="adm-muted">—</span>}{r.missing && <Badge tone="warning">not listed</Badge>}</span> },
    { key: "size", label: "Size", sortable: false },
  ];
  const editing = openId === "new" ? null : openId ? list.find((x) => x.id === openId) : undefined;
  const newId = () => { let n = list.length + 1, id; do id = `${type.slice(0, 2)}-${n++}`; while (list.some((x) => x.id === id)); return id; };

  return (
    <div className="adm-section">
      <div className="adm-tabs" role="tablist">
        {Object.entries(LIBRARY_TYPES).map(([id, t]) => <button key={id} role="tab" aria-selected={type === id} className={type === id ? "on" : ""} onClick={() => setType(id === "stories" ? "" : id)}>{t.label} <Badge>{(content[id] || []).length}</Badge></button>)}
      </div>
      <div className="adm-kpis compact">
        <Kpi label={T.label} value={list.length} />
        <Kpi label="Categories used" value={new Set(list.map((x) => x.category).filter(Boolean)).size} />
        <Kpi label="In an unlisted category" value={rows.filter((r) => r.missing).length} tone={rows.some((r) => r.missing) ? "attention" : ""} />
      </div>
      <DataTable id={`library-${type}`} syncUrl columns={columns} rows={rows} rowKey={(r) => r.id || `i${r.i}`} csvName={`word-hunter-${type}`} resetKey={type}
        searchText={(r) => `${r.id} ${r.title} ${r.category} ${JSON.stringify(r.x)}`} searchPlaceholder={`Search ${T.label.toLowerCase()}…`}
        selectable onRowClick={(r) => onOpen(r.id)} emptyText={`No ${T.label.toLowerCase()} yet. Import a content file, or add one.`}
        toolbar={<button className="adm-btn primary" onClick={() => onOpen("new")}><Plus size={15} /> New {T.one}</button>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" onClick={() => { setMoveTo({ ids: sel.map((r) => r.id), clear }); setMoveInput(""); }}><FolderInput size={15} /> Move to…</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ ids: sel.map((r) => r.id), clear })}><Trash2 size={15} /> Delete</button>
        </>} />
      {(editing || openId === "new") && <ItemEditor key={`${type}:${openId}`} type={type} item={editing || T.blank(newId(), categories[0] || "General")} isNew={!editing} list={list} content={content} categories={categories}
        onClose={() => onOpen(null)}
        onSave={(next, original) => { onUpdate(type, original ? list.map((x) => (x === original ? next : x)) : [...list, next]); onOpen(null); }}
        onDuplicate={(item) => { const copy = { ...item, id: newId() }; onUpdate(type, [...list, copy]); onOpen(copy.id); }}
        onDelete={(item) => setConfirm({ ids: [item.id], clear: () => onOpen(null) })} />}
      {openId && openId !== "new" && !editing && <Drawer title="Not found" onClose={() => onOpen(null)}><p>No {T.one} with the id “{openId}”.</p></Drawer>}
      {moveTo && <ConfirmDialog title={`Move ${moveTo.ids.length} ${moveTo.ids.length === 1 ? T.one : T.label.toLowerCase()}`} confirmLabel="Move"
        body={<label className="adm-field"><span>Category</span><input className="adm-input" list="adm-lib-cats" value={moveInput} onChange={(e) => setMoveInput(e.target.value)} autoFocus /><datalist id="adm-lib-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>}
        onCancel={() => setMoveTo(null)} onConfirm={() => { const name = moveInput.trim(); if (!name) return; const ids = new Set(moveTo.ids); onUpdate(type, list.map((x) => (ids.has(x.id) ? { ...x, category: name } : x))); moveTo.clear(); setMoveTo(null); }} />}
      {confirm && <ConfirmDialog danger title={`Delete ${confirm.ids.length} ${confirm.ids.length === 1 ? T.one : T.label.toLowerCase()}?`} confirmLabel="Delete"
        body={<p>{confirm.ids.slice(0, 10).join(", ")}{confirm.ids.length > 10 ? "…" : ""}. You can bring them back from the Activity log.</p>}
        onCancel={() => setConfirm(null)} onConfirm={() => { const ids = new Set(confirm.ids); onUpdate(type, list.filter((x) => !ids.has(x.id))); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}

function ItemEditor({ type, item, isNew, list, content, categories, onClose, onSave, onDuplicate, onDelete }) {
  const T = LIBRARY_TYPES[type];
  const titleKey = type === "challenges" ? "label" : "title";
  const [text, setText] = useState(() => JSON.stringify(item, null, 2));
  const [errors, setErrors] = useState([]);
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  const setField = (k, v) => { if (!parsed) return; setText(JSON.stringify({ ...parsed, [k]: v }, null, 2)); setErrors([]); };
  const dirty = !parsed || !sameItem(parsed, item) || isNew;
  function save() {
    if (!parsed) { setErrors(["The JSON isn't valid: check commas, quotes and brackets."]); return; }
    const problems = libraryProblems(type, parsed, list, isNew ? null : item, content);
    if (problems.length) { setErrors(problems); return; }
    onSave(parsed, isNew ? null : item);
  }
  return (
    <Drawer title={isNew ? `New ${T.one}` : T.title(item) || item.id} subtitle={`${T.label} · ${item.id}`} onClose={onClose}>
      <div className="adm-editor">
        {errors.length > 0 && <Notice tone="error">{errors.map((e, i) => <div key={i}>{e}</div>)}</Notice>}
        <div className="adm-form-grid">
          <label className="adm-field"><span>Title</span><input className="adm-input" disabled={!parsed} value={parsed?.[titleKey] ?? ""} onChange={(e) => setField(titleKey, e.target.value)} /></label>
          <label className="adm-field"><span>Category</span><input className="adm-input" disabled={!parsed} list="adm-lib-cats2" value={parsed?.category ?? ""} onChange={(e) => setField("category", e.target.value)} /><datalist id="adm-lib-cats2">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
        </div>
        <label className="adm-field"><span>All fields (JSON){!parsed && <small className="adm-warn-text"> · not valid JSON yet</small>}</span>
          <textarea className="adm-input adm-textarea mono" rows={24} spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setErrors([]); }} /></label>
        <footer className="adm-editor-foot">
          <button className="adm-btn primary" disabled={!dirty} onClick={save}>{isNew ? `Add ${T.one}` : "Save changes"}</button>
          <button className="adm-btn ghost" disabled={!parsed} onClick={() => setText(JSON.stringify(parsed, null, 2))}>Tidy JSON</button>
          {!isNew && <button className="adm-btn ghost" onClick={() => onDuplicate(item)}><Copy size={15} /> Duplicate</button>}
          <span className="adm-toolbar-spacer" />
          {!isNew && <button className="adm-btn danger" onClick={() => onDelete(item)}><Trash2 size={15} /> Delete</button>}
        </footer>
      </div>
    </Drawer>
  );
}
