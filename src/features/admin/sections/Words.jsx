import { useMemo, useState } from "react";
import { FileJson, FolderInput, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { V2 } from "../../../engine/v2";
import { DataTable, downloadText } from "../DataTable";
import { formatNumber, formatPercent } from "../charts";
import { Badge, ConfirmDialog, Kpi, Notice } from "../adminUi";

// What a word is missing, in the order an editor would fix it.
export function wordIssues(w) {
  const out = [];
  if (w._autoStub) out.push("stub");
  if (!w.meaning) out.push("no meaning");
  if (!w.situation) out.push("no example");
  if (!w.gap) out.push("no gap");
  else if (!/_{3,}/.test(w.gap)) out.push("gap has no blank");
  if (!w.hints?.length) out.push("no hints");
  return out;
}
const hasPicture = (w) => !!(w.image || V2.isIllustration(w.illustration));
const ISSUE_FILTERS = [
  { id: "", label: "All words" },
  { id: "any", label: "Needs attention" },
  { id: "stub", label: "AI stubs" },
  { id: "no example", label: "No example" },
  { id: "no gap", label: "No gap sentence" },
  { id: "no hints", label: "No hints" },
  { id: "picture", label: "Has a picture" },
  { id: "nopicture", label: "No picture" },
  { id: "hard", label: "Hard for the class (<50%)" },
  { id: "unplayed", label: "Never answered" },
];

export function Words({ content, wordStats, mastery, onUpdate, onEdit, onCreate }) {
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [issue, setIssue] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [moveTo, setMoveTo] = useState(null); // { rows, clear } | null
  const [moveInput, setMoveInput] = useState("");
  const stats = useMemo(() => new Map((wordStats.data || []).map((s) => [s.item_key, s])), [wordStats.data]);
  const words = content.words;
  const categories = useMemo(() => [...new Set(words.map((w) => w.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [words]);
  const types = useMemo(() => [...new Set(words.map((w) => w.type).filter(Boolean))].sort(), [words]);
  const enriched = useMemo(() => words.map((w, index) => {
    const s = stats.get(w.word);
    return { w, index, word: w.word, category: w.category || "", type: w.type || "", attempts: s?.attempts || 0, players: s?.players || 0, accuracy: s?.attempts ? s.correct / s.attempts : null, issues: wordIssues(w), picture: hasPicture(w), stage: V2.stage(mastery[w.word]) };
  }), [words, stats, mastery]);
  const rows = useMemo(() => enriched.filter((r) => (!category || r.category === category) && (!type || r.type === type) && (
    !issue || (issue === "any" && r.issues.length) || r.issues.includes(issue) || (issue === "picture" && r.picture) || (issue === "nopicture" && !r.picture)
    || (issue === "hard" && r.accuracy != null && r.accuracy < 0.5 && r.attempts >= 5) || (issue === "unplayed" && !r.attempts))), [enriched, category, type, issue]);

  const columns = [
    { key: "word", label: "Word", render: (r) => <span className="adm-word">{r.picture ? <ImageIcon size={14} className="adm-has-pic" aria-label="has a picture" /> : <i className="adm-pic-gap" />}<b>{r.word}</b><small>{r.w.meaning}</small></span> },
    { key: "category", label: "Category" },
    { key: "type", label: "Type", render: (r) => <Badge>{r.type || "—"}</Badge> },
    { key: "accuracy", label: "Class accuracy", num: true, defaultDir: "asc", csv: (r) => (r.accuracy == null ? "" : Math.round(r.accuracy * 100)), render: (r) => (r.accuracy == null ? <span className="adm-muted">—</span> : <span className="adm-meter" title={`${r.attempts} answers`}><i style={{ width: `${Math.round(r.accuracy * 100)}%` }} />{formatPercent(r.accuracy)}</span>) },
    { key: "attempts", label: "Answers", num: true, defaultDir: "desc", render: (r) => formatNumber(r.attempts) },
    { key: "players", label: "Players", num: true, defaultDir: "desc" },
    { key: "stage", label: "Your stage", render: (r) => <Badge tone={r.stage === "Mastered" ? "success" : r.stage === "New" ? "neutral" : "info"}>{r.stage}</Badge> },
    { key: "issues", label: "Issues", sortValue: (r) => r.issues.length, csv: (r) => r.issues.join("; "), render: (r) => (r.issues.length ? <span className="adm-tags">{r.issues.map((i) => <Badge key={i} tone="warning">{i}</Badge>)}</span> : <Badge tone="success">ready</Badge>) },
  ];

  function deleteRows(sel) {
    const drop = new Set(sel.map((r) => r.word));
    onUpdate("words", words.filter((w) => !drop.has(w.word)));
  }
  function moveRows(sel, target) {
    const name = target.trim();
    if (!name) return;
    if (!(content.levels || []).some((l) => l.title === name)) onUpdate("levels", [...(content.levels || []), { id: `cat-${name}`, title: name }]);
    const ids = new Set(sel.map((r) => r.word));
    onUpdate("words", words.map((w) => (ids.has(w.word) ? { ...w, category: name } : w)));
  }

  const attention = enriched.filter((r) => r.issues.length).length;
  return (
    <div className={`adm-section ${wordStats.loading ? "is-refreshing" : ""}`}>
      {wordStats.error && <Notice tone="error">{wordStats.error}</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Words" value={words.length} sub={`${categories.length} categories`} />
        <Kpi label="Needs attention" value={attention} tone={attention ? "attention" : ""} />
        <Kpi label="With a picture" value={enriched.filter((r) => r.picture).length} />
        <Kpi label="Never answered" value={enriched.filter((r) => !r.attempts).length} />
      </div>
      <DataTable
        id="words" columns={columns} rows={rows} rowKey={(r) => r.word} csvName="word-hunter-words"
        searchText={(r) => `${r.word} ${r.w.meaning || ""} ${r.category} ${(r.w.synonyms || []).join(" ")}`} searchPlaceholder="Search words, meanings, categories…"
        resetKey={`${category}|${type}|${issue}`} selectable onRowClick={(r) => onEdit(r.word)}
        filters={<>
          <select className="adm-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select className="adm-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select className="adm-select" value={issue} onChange={(e) => setIssue(e.target.value)} aria-label="Quality filter">{ISSUE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </>}
        toolbar={<button className="adm-btn primary" onClick={onCreate}><Plus size={15} /> New word</button>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" onClick={() => { setMoveTo({ rows: sel, clear }); setMoveInput(""); }}><FolderInput size={15} /> Move to…</button>
          <button className="adm-btn ghost" onClick={() => downloadText(`word-hunter-words-${sel.length}.json`, JSON.stringify({ schemaVersion: 2, kind: "content", words: sel.map((r) => r.w) }, null, 2), "application/json")}><FileJson size={15} /> Export JSON</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ rows: sel, clear })}><Trash2 size={15} /> Delete</button>
        </>}
        emptyText="No words yet. Import a backup from Data, or add one."
      />
      {moveTo && <ConfirmDialog title={`Move ${moveTo.rows.length} word${moveTo.rows.length === 1 ? "" : "s"}`} confirmLabel="Move"
        body={<label className="adm-field"><span>Category</span><input list="adm-cats" value={moveInput} onChange={(e) => setMoveInput(e.target.value)} placeholder="Pick or type a category" autoFocus /><datalist id="adm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist><small className="adm-muted">A new name becomes a new level.</small></label>}
        onCancel={() => setMoveTo(null)} onConfirm={() => { if (!moveInput.trim()) return; moveRows(moveTo.rows, moveInput); moveTo.clear(); setMoveTo(null); }} />}
      {confirm && <ConfirmDialog title={`Delete ${confirm.rows.length} word${confirm.rows.length === 1 ? "" : "s"}?`} danger confirmLabel="Delete" confirmText={confirm.rows.length > 5 ? "DELETE" : undefined}
        body={<><p>They disappear from every player's game. Learning history stays in players' progress but is no longer shown.</p><p className="adm-muted">{confirm.rows.slice(0, 12).map((r) => r.word).join(", ")}{confirm.rows.length > 12 ? ` and ${confirm.rows.length - 12} more` : ""}</p></>}
        onCancel={() => setConfirm(null)} onConfirm={() => { deleteRows(confirm.rows); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}
