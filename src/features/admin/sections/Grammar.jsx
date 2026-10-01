// Grammar rules: every rule with its lesson, level, questions and how the
// class does on it; filters in the address (/admin/grammar?lesson=Media&
// issue=any); a rule opens in the editor at /admin/grammar/<id>.
import { useMemo, useState } from "react";
import { FileJson, FolderInput, Plus, Trash2 } from "lucide-react";
import { useQuery } from "../../../lib/router";
import { V2 } from "../../../engine/v2";
import { DataTable, downloadText } from "../DataTable";
import { formatNumber, formatPercent } from "../charts";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice } from "../adminUi";
import { GrammarEditor } from "../editors/GrammarEditor";
import { GRAMMAR_LEVELS, GRAMMAR_TYPES, blankGrammarRule, grammarIssues, grammarPreview, isSingleQuestionRule, questionCount, questionTypes } from "../editors/grammarRules";

const ISSUE_FILTERS = [
  { id: "", label: "All rules" },
  { id: "any", label: "Needs attention" },
  { id: "invalid", label: "Has errors" },
  { id: "no-explanation", label: "No explanation" },
  { id: "single", label: "Single question" },
  { id: "hard", label: "Hard for the class (<50%)" },
  { id: "unplayed", label: "Never answered" },
];
const TYPE_SHORT = { choose: "choose", judge: "right/wrong", fix: "fix" };

export function Grammar({ content, wordStats, onUpdate, openId, onOpen }) {
  const rules = content.grammar || [];
  const [filters, setFilters] = useQuery({ lesson: "", level: "", type: "", issue: "" });
  const { lesson, level, type, issue } = filters;
  const [confirm, setConfirm] = useState(null);
  const [moveTo, setMoveTo] = useState(null);
  const [moveInput, setMoveInput] = useState("");
  const [notice, setNotice] = useState(null);
  const stats = useMemo(() => new Map((wordStats.data || []).filter((s) => s.item_key.startsWith("grammar:")).map((s) => [s.item_key.slice(8), s])), [wordStats.data]);
  const lessonsUsed = useMemo(() => [...new Set(rules.map((g) => g.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rules]);
  const allLessons = useMemo(() => (content.levels || []).map((l) => l.title), [content.levels]);
  const enriched = useMemo(() => rules.map((g) => {
    const s = stats.get(g.id);
    return { g, id: g.id, rule: g.rule || "", lesson: g.category || "", level: g.level || "", count: questionCount(g), types: questionTypes(g), preview: grammarPreview(g), single: isSingleQuestionRule(g), issues: grammarIssues(g), attempts: s?.attempts || 0, players: s?.players || 0, accuracy: s?.attempts ? s.correct / s.attempts : null };
  }), [rules, stats]);
  const rows = useMemo(() => enriched.filter((r) => (!lesson || r.lesson === lesson) && (!level || r.level === level) && (!type || r.types[type])
    && (!issue || (issue === "any" && r.issues.length) || r.issues.some((i) => i.id === issue) || (issue === "single" && r.single)
      || (issue === "hard" && r.accuracy != null && r.accuracy < 0.5 && r.attempts >= 5) || (issue === "unplayed" && !r.attempts))), [enriched, lesson, level, type, issue]);

  const columns = [
    { key: "rule", label: "Rule", render: (r) => <span className="adm-word"><b>{r.rule || <span className="adm-muted">(no rule)</span>}</b><small>{r.preview}</small></span> },
    { key: "lesson", label: "Lesson", render: (r) => r.lesson || <span className="adm-muted">—</span> },
    { key: "level", label: "Level", render: (r) => (r.level ? <Badge>{r.level}</Badge> : <span className="adm-muted">—</span>) },
    { key: "count", label: "Questions", num: true, defaultDir: "desc", csv: (r) => r.count, render: (r) => <span className="gr-count"><b>{r.count}</b>{Object.entries(r.types).map(([t, n]) => <small key={t}>{n} {TYPE_SHORT[t] || t}</small>)}</span> },
    { key: "accuracy", label: "Class accuracy", num: true, defaultDir: "asc", csv: (r) => (r.accuracy == null ? "" : Math.round(r.accuracy * 100)), render: (r) => (r.accuracy == null ? <span className="adm-muted">—</span> : <span className="adm-meter" title={`${r.attempts} answers by ${r.players} player${r.players === 1 ? "" : "s"}`}><i style={{ width: `${Math.round(r.accuracy * 100)}%` }} />{formatPercent(r.accuracy)}</span>) },
    { key: "attempts", label: "Answers", num: true, defaultDir: "desc", render: (r) => formatNumber(r.attempts) },
    { key: "issues", label: "Status", sortValue: (r) => r.issues.length, csv: (r) => r.issues.map((i) => i.label).join("; "), render: (r) => (r.issues.length ? <span className="adm-tags">{r.issues.map((i) => <Badge key={i.id} tone={i.tone}>{i.label}</Badge>)}</span> : <Badge tone="success">ready</Badge>) },
  ];

  const questions = enriched.reduce((n, r) => n + r.count, 0);
  const attention = enriched.filter((r) => r.issues.length).length;
  const uncovered = allLessons.filter((l) => !lessonsUsed.includes(l));
  const newId = () => { let id; do id = `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`; while (rules.some((g) => g.id === id)); return id; };
  const editing = openId === "new" ? null : openId ? rules.find((g) => V2.norm(g.id) === V2.norm(openId)) : undefined;
  const blank = useMemo(() => (openId === "new" ? blankGrammarRule(newId(), lesson || allLessons[0] || "") : null), [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  function ensureLesson(name) {
    if (name && !(content.levels || []).some((l) => l.title === name)) onUpdate("levels", [...(content.levels || []), { id: `cat-${name}`, title: name }]);
  }
  function save(next) {
    ensureLesson(next.category);
    if (!editing) onUpdate("grammar", [...rules, next]);
    else onUpdate("grammar", rules.map((g) => (g === editing ? next : g)));
    setNotice(editing ? `Saved “${next.rule}”.` : `Added “${next.rule}”.`);
    onOpen(null);
  }
  function duplicate(rule) {
    const copy = { ...rule, id: newId(), rule: `${rule.rule} (copy)` };
    onUpdate("grammar", [...rules, copy]);
    onOpen(copy.id);
  }

  return (
    <div className={`adm-section ${wordStats.loading ? "is-refreshing" : ""}`}>
      {wordStats.error && <Notice tone="error">{wordStats.error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Rules" value={rules.length} sub={`${lessonsUsed.length} lessons`} />
        <Kpi label="Questions" value={questions} sub={rules.length ? `${(questions / rules.length).toFixed(1)} per rule` : ""} />
        <Kpi label="Needs attention" value={attention} tone={attention ? "attention" : ""} />
        <Kpi label="Lessons without grammar" value={uncovered.length} sub={uncovered.slice(0, 3).join(", ") + (uncovered.length > 3 ? "…" : "")} />
      </div>
      <DataTable id="grammar" syncUrl columns={columns} rows={rows} rowKey={(r) => r.id} csvName="word-hunter-grammar"
        searchText={(r) => `${r.rule} ${r.id} ${r.lesson} ${r.g.explanation || ""} ${JSON.stringify(r.g.questions || [r.g.prompt, r.g.options])}`} searchPlaceholder="Search rules, sentences, lessons…"
        resetKey={`${lesson}|${level}|${type}|${issue}`} selectable onRowClick={(r) => onOpen(r.id)}
        filters={<>
          <select className="adm-select" value={lesson} onChange={(e) => setFilters({ lesson: e.target.value, page: null })} aria-label="Lesson"><option value="">All lessons</option>{lessonsUsed.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select className="adm-select" value={level} onChange={(e) => setFilters({ level: e.target.value, page: null })} aria-label="Level"><option value="">Any level</option>{GRAMMAR_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <select className="adm-select" value={type} onChange={(e) => setFilters({ type: e.target.value, page: null })} aria-label="Question type"><option value="">Any question type</option>{Object.entries(GRAMMAR_TYPES).map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
          <select className="adm-select" value={issue} onChange={(e) => setFilters({ issue: e.target.value, page: null })} aria-label="Status">{ISSUE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </>}
        toolbar={<button className="adm-btn primary" onClick={() => onOpen("new")}><Plus size={15} /> New rule</button>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" onClick={() => { setMoveTo({ ids: sel.map((r) => r.id), clear }); setMoveInput(""); }}><FolderInput size={15} /> Move to…</button>
          <button className="adm-btn ghost" onClick={() => downloadText(`word-hunter-grammar-${sel.length}.json`, JSON.stringify({ schemaVersion: 2, kind: "content", grammar: sel.map((r) => r.g) }, null, 2), "application/json")}><FileJson size={15} /> Export JSON</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ ids: sel.map((r) => r.id), clear })}><Trash2 size={15} /> Delete</button>
        </>}
        emptyText={rules.length ? "No rules match these filters." : "No grammar rules yet. Add one, or import a content file with a grammar list."} />
      {(editing || openId === "new") && <GrammarEditor key={openId} rule={editing || blank} isNew={!editing} content={content} stats={editing ? stats.get(editing.id) : null}
        onSave={save} onDuplicate={duplicate} onClose={() => onOpen(null)}
        onDelete={(g) => { onUpdate("grammar", rules.filter((x) => x !== g)); setNotice(`Deleted “${g.rule || g.id}”.`); onOpen(null); }} />}
      {openId && openId !== "new" && !editing && <Drawer title="Rule not found" onClose={() => onOpen(null)}><p>No grammar rule with the id “{openId}”. It may have been deleted; the Activity log shows what happened.</p></Drawer>}
      {moveTo && <ConfirmDialog title={`Move ${moveTo.ids.length} rule${moveTo.ids.length === 1 ? "" : "s"}`} confirmLabel="Move"
        body={<label className="adm-field"><span>Lesson</span><input className="adm-input" list="gr-move-lessons" value={moveInput} onChange={(e) => setMoveInput(e.target.value)} placeholder="Pick or type a lesson" autoFocus /><datalist id="gr-move-lessons">{allLessons.map((c) => <option key={c} value={c} />)}</datalist><small className="adm-muted">A new name becomes a new category.</small></label>}
        onCancel={() => setMoveTo(null)} onConfirm={() => { const name = moveInput.trim(); if (!name) return; ensureLesson(name); const ids = new Set(moveTo.ids); onUpdate("grammar", rules.map((g) => { if (!ids.has(g.id)) return g; const { categoryId, ...rest } = g; return { ...rest, category: name }; })); moveTo.clear(); setMoveTo(null); }} />}
      {confirm && <ConfirmDialog danger title={`Delete ${confirm.ids.length} rule${confirm.ids.length === 1 ? "" : "s"}?`} confirmLabel="Delete" confirmText={confirm.ids.length > 5 ? "DELETE" : undefined}
        body={<><p>They disappear from every player's game. You can bring them back from the Activity log.</p><p className="adm-muted">{rules.filter((g) => confirm.ids.includes(g.id)).slice(0, 10).map((g) => g.rule || g.id).join(", ")}{confirm.ids.length > 10 ? "…" : ""}</p></>}
        onCancel={() => setConfirm(null)} onConfirm={() => { const ids = new Set(confirm.ids); onUpdate("grammar", rules.filter((g) => !ids.has(g.id))); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}
