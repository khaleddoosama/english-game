import { useMemo, useState } from "react";
import { useQuery } from "../../../lib/router";
import { FileJson, FolderInput, Image as ImageIcon, Plus, Sparkles, Trash2 } from "lucide-react";
import { askAiForWord } from "../../../engine/ai";
import { WordEditor } from "../editors/WordEditor";
import { V2 } from "../../../engine/v2";
import { DataTable, downloadText } from "../DataTable";
import { formatNumber, formatPercent } from "../charts";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice } from "../adminUi";

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
  { id: "hard", label: "Hard for the class (<50%)" },
  { id: "unplayed", label: "Never answered" },
];

// openWord: the word in the address (/admin/words/<word>, or "new").
export function Words({ content, wordStats, mastery, onUpdate, onRenameWord, openWord, onOpen }) {
  const onEdit = (word) => onOpen(word);
  const onCreate = () => onOpen("new");
  // Filters live in the address: /admin/words?category=Food&hasPicture=false
  const [filters, setFilters] = useQuery({ category: "", type: "", issue: "", hasPicture: "" });
  const { category, type, issue, hasPicture: pictureFilter } = filters;
  const setCategory = (v) => setFilters({ category: v, page: null });
  const setType = (v) => setFilters({ type: v, page: null });
  const setIssue = (v) => setFilters({ issue: v, page: null });
  const setPicture = (v) => setFilters({ hasPicture: v, page: null });
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
  const rows = useMemo(() => enriched.filter((r) => (!category || r.category === category) && (!type || r.type === type)
    && (pictureFilter === "" || r.picture === (pictureFilter === "true")) && (
    !issue || (issue === "any" && r.issues.length) || r.issues.includes(issue)
    || (issue === "hard" && r.accuracy != null && r.accuracy < 0.5 && r.attempts >= 5) || (issue === "unplayed" && !r.attempts))), [enriched, category, type, issue, pictureFilter]);

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
  const stubs = words.filter((w) => w._autoStub);
  const [fill, setFill] = useState(null); // { done, total, failed: [] }
  // Stub words (made from a missing reference during an import) get real
  // content from AI, one at a time; one save at the end.
  async function fillStubs() {
    let next = [...words];
    const failed = [];
    setFill({ done: 0, total: stubs.length, failed });
    for (const stub of stubs) {
      try {
        const g = await askAiForWord(stub.word, stub);
        const updated = { ...stub, type: g.type, category: stub.category || g.category, meaning: g.meaning, situation: g.situation, gap: g.gap, hints: g.hints, ...(g.commonMistake ? { commonMistake: g.commonMistake } : {}) };
        delete updated._autoStub;
        if (/[\u0600-\u06FF]/.test(JSON.stringify(updated))) throw new Error("AI answered with non-English text.");
        const problems = V2.validateContent({ schemaVersion: 2, kind: "content", words: [updated] }, content);
        if (problems.length) throw new Error(problems[0]);
        next = next.map((w) => (w.word === stub.word ? updated : w));
      } catch (e) { failed.push({ word: stub.word, message: e.message || "AI failed" }); }
      setFill((f) => ({ ...f, done: f.done + 1, failed: [...failed] }));
    }
    if (next.some((w, i) => w !== words[i])) onUpdate("words", next);
  }
  const editing = openWord === "new" ? null : openWord ? words.find((w) => V2.norm(w.word) === V2.norm(openWord)) : undefined;
  function saveWord(next, original) {
    if (next.category && !(content.levels || []).some((l) => l.title === next.category)) onUpdate("levels", [...(content.levels || []), { id: `cat-${next.category}`, title: next.category }]);
    if (!original) onUpdate("words", [...words, next]);
    else if (V2.norm(original.word) !== V2.norm(next.word) && onRenameWord) onRenameWord(original.word, next);
    else onUpdate("words", words.map((w) => (w === original ? next : w)));
    onOpen(null);
  }
  return (
    <div className={`adm-section ${wordStats.loading ? "is-refreshing" : ""}`}>
      {wordStats.error && <Notice tone="error">{wordStats.error}</Notice>}
      {fill && fill.done >= fill.total && <Notice tone={fill.failed.length ? "error" : "info"}>AI filled {fill.total - fill.failed.length} of {fill.total} stub words.{fill.failed.length ? ` Failed: ${fill.failed.map((f) => `${f.word} (${f.message})`).join("; ")}` : ""}</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Words" value={words.length} sub={`${categories.length} categories`} />
        <Kpi label="Needs attention" value={attention} tone={attention ? "attention" : ""} />
        <Kpi label="With a picture" value={enriched.filter((r) => r.picture).length} />
        <Kpi label="Never answered" value={enriched.filter((r) => !r.attempts).length} />
      </div>
      <DataTable
        id="words" columns={columns} rows={rows} rowKey={(r) => r.word} csvName="word-hunter-words"
        searchText={(r) => `${r.word} ${r.w.meaning || ""} ${r.category} ${(r.w.synonyms || []).join(" ")}`} searchPlaceholder="Search words, meanings, categories…"
        resetKey={`${category}|${type}|${issue}|${pictureFilter}`} syncUrl selectable onRowClick={(r) => onEdit(r.word)}
        filters={<>
          <select className="adm-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select className="adm-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select className="adm-select" value={pictureFilter} onChange={(e) => setPicture(e.target.value)} aria-label="Picture"><option value="">Any picture</option><option value="true">Has a picture</option><option value="false">No picture</option></select>
          <select className="adm-select" value={issue} onChange={(e) => setIssue(e.target.value)} aria-label="Quality filter">{ISSUE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </>}
        toolbar={<>
          {stubs.length > 0 && <button className="adm-btn ghost" disabled={fill && fill.done < fill.total} onClick={fillStubs}><Sparkles size={15} /> {fill && fill.done < fill.total ? `Filling ${fill.done}/${fill.total}…` : `Fill ${stubs.length} stub${stubs.length === 1 ? "" : "s"} with AI`}</button>}
          <button className="adm-btn primary" onClick={onCreate}><Plus size={15} /> New word</button>
        </>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" onClick={() => { setMoveTo({ rows: sel, clear }); setMoveInput(""); }}><FolderInput size={15} /> Move to…</button>
          <button className="adm-btn ghost" onClick={() => downloadText(`word-hunter-words-${sel.length}.json`, JSON.stringify({ schemaVersion: 2, kind: "content", words: sel.map((r) => r.w) }, null, 2), "application/json")}><FileJson size={15} /> Export JSON</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ rows: sel, clear })}><Trash2 size={15} /> Delete</button>
        </>}
        emptyText="No words yet. Import a backup from Data, or add one."
      />
      {editing !== undefined && editing !== null || openWord === "new" ? <WordEditor key={openWord} word={editing || null} content={content} stats={editing ? stats.get(editing.word) : null}
        onSave={saveWord} onDelete={(w) => { onUpdate("words", words.filter((x) => x !== w)); onOpen(null); }} onClose={() => onOpen(null)} /> : null}
      {openWord && openWord !== "new" && !editing && <Drawer title="Word not found" onClose={() => onOpen(null)}><p>No word called “{openWord}”. It may have been renamed or deleted; the Activity log shows what happened.</p></Drawer>}
      {moveTo && <ConfirmDialog title={`Move ${moveTo.rows.length} word${moveTo.rows.length === 1 ? "" : "s"}`} confirmLabel="Move"
        body={<label className="adm-field"><span>Category</span><input list="adm-cats" value={moveInput} onChange={(e) => setMoveInput(e.target.value)} placeholder="Pick or type a category" autoFocus /><datalist id="adm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist><small className="adm-muted">A new name becomes a new level.</small></label>}
        onCancel={() => setMoveTo(null)} onConfirm={() => { if (!moveInput.trim()) return; moveRows(moveTo.rows, moveInput); moveTo.clear(); setMoveTo(null); }} />}
      {confirm && <ConfirmDialog title={`Delete ${confirm.rows.length} word${confirm.rows.length === 1 ? "" : "s"}?`} danger confirmLabel="Delete" confirmText={confirm.rows.length > 5 ? "DELETE" : undefined}
        body={<><p>They disappear from every player's game. Learning history stays in players' progress but is no longer shown.</p><p className="adm-muted">{confirm.rows.slice(0, 12).map((r) => r.word).join(", ")}{confirm.rows.length > 12 ? ` and ${confirm.rows.length - 12} more` : ""}</p></>}
        onCancel={() => setConfirm(null)} onConfirm={() => { deleteRows(confirm.rows); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}
