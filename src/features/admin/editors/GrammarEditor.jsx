// Grammar rule editor (Admin -> Grammar -> a rule, or New rule): the rule
// and its explanation, examples and common mistakes, then its questions as
// cards: choose (options with the right one marked), right-or-wrong, and
// fix-the-sentence, each with a preview of what the learner sees. AI can
// write more questions for review. Saving checks the rule like an import.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Code2, Copy, Eye, EyeOff, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Badge, ConfirmDialog, Drawer, Notice } from "../adminUi";
import { Area, Text, sameItem } from "./WordEditor";
import { GRAMMAR_LEVELS, GRAMMAR_TYPES, blankGrammarQuestion, cleanGrammarDraft, generateGrammarQuestions, grammarDraftOf, grammarDraftProblems, isSingleQuestionRule } from "./grammarRules";

const JUDGE_OK = "It's correct as it is";

export function GrammarEditor({ rule, isNew, content, stats, onSave, onDelete, onDuplicate, onClose }) {
  const rules = content.grammar || [];
  const lessons = useMemo(() => [...new Set([...(content.levels || []).map((l) => l.title), ...rules.map((g) => g.category).filter(Boolean)])], [content.levels, rules]);
  const start = useMemo(() => grammarDraftOf(rule), [rule]);
  const [draft, setDraftState] = useState(start);
  const [json, setJson] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [note, setNote] = useState(null);
  const [preview, setPreview] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const setDraft = (patch) => { setDraftState((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) })); setNote(null); };
  const cleaned = useMemo(() => cleanGrammarDraft(draft), [draft]);
  const others = useMemo(() => rules.filter((g) => isNew || g.id !== rule.id), [rules, rule, isNew]);
  const problems = useMemo(() => grammarDraftProblems(cleaned, others), [cleaned, others]);
  const dirty = isNew || json != null || !sameItem(cleaned, cleanGrammarDraft(start));
  const old = !isNew && isSingleQuestionRule(rule);
  const general = problems.filter((p) => p.at == null);
  const forQuestion = (i) => problems.filter((p) => p.at === i);

  const setQuestion = (i, q) => setDraft((d) => ({ questions: d.questions.map((x, j) => (j === i ? q : x)) }));
  const moveQuestion = (i, by) => setDraft((d) => { const qs = [...d.questions]; const [q] = qs.splice(i, 1); qs.splice(i + by, 0, q); return { questions: qs }; });
  const addQuestion = (type) => setDraft((d) => ({ questions: [...d.questions, blankGrammarQuestion(type)] }));

  function save() {
    let next = cleaned;
    if (json != null) {
      try { next = cleanGrammarDraft(grammarDraftOf(JSON.parse(json))); } catch { setShowErrors(true); setNote({ tone: "error", text: "The JSON isn't valid. Fix it or go back to the form." }); return; }
      const p = grammarDraftProblems(next, others);
      if (p.length) { setShowErrors(true); setNote({ tone: "error", text: p.map((x) => (x.at == null ? x.text : `Question ${x.at + 1}: ${x.text}`)).join(" · ") }); return; }
    } else if (problems.length) { setShowErrors(true); return; }
    // A new lesson name means the old lesson id no longer applies.
    if (next.categoryId && next.category !== rule.category) delete next.categoryId;
    onSave(next);
  }
  const close = () => (dirty ? setConfirmClose(true) : onClose());
  const count = draft.questions.length;

  return (
    <Drawer title={isNew ? "New grammar rule" : rule.rule || rule.id} onClose={close}
      subtitle={isNew ? "Write the rule, then its questions, or let AI write them" : `${rule.category || "no lesson"} · ${count} question${count === 1 ? "" : "s"}${stats?.attempts ? ` · ${stats.players} player${stats.players === 1 ? "" : "s"}, ${Math.round((stats.correct / stats.attempts) * 100)}% right` : ""}`}
      actions={old ? <Badge tone="info">single question</Badge> : null}>
      <div className="adm-editor gr-editor">
        {old && <Notice>This rule has one question in the older format. Saving turns it into a question set, so you can add more; its progress stays.</Notice>}
        {showErrors && general.length > 0 && <Notice tone="error">{general.map((p, i) => <div key={i}>{p.text}</div>)}</Notice>}
        {showErrors && problems.some((p) => p.at != null) && <Notice tone="error">Some questions need fixing; they're marked below.</Notice>}
        {note && <Notice tone={note.tone || "info"}>{note.text}</Notice>}
        {json != null ? <>
          <Area label="Rule as JSON" hint="every field, including ones the form doesn't show" rows={24} mono value={json} onChange={setJson} />
          <div className="adm-row"><button className="adm-btn ghost" onClick={() => { try { setDraftState(grammarDraftOf(JSON.parse(json))); setJson(null); } catch { setNote({ tone: "error", text: "The JSON isn't valid." }); } }}>Back to the form</button></div>
        </> : <>
          <section className="adm-editor-sec">
            <h4>The rule</h4>
            <Text label="Rule" value={draft.rule} onChange={(v) => setDraft({ rule: v })} placeholder="e.g. Going to (plans and predictions)" />
            <div className="adm-form-grid">
              <Text label="Lesson" hint="the category it's practised in" value={draft.category} onChange={(v) => setDraft({ category: v })} list="gr-lessons" />
              <label className="adm-field"><span>Level</span><select className="adm-select" value={draft.level || ""} onChange={(e) => setDraft({ level: e.target.value })}><option value="">—</option>{[...new Set([...GRAMMAR_LEVELS, ...(draft.level ? [draft.level] : [])])].map((l) => <option key={l}>{l}</option>)}</select></label>
              <label className="adm-field"><span>Id <small className="adm-muted">· {isNew ? "keeps players' progress; can't change later" : "fixed"}</small></span><input className="adm-input mono" value={draft.id} disabled={!isNew} onChange={(e) => setDraft({ id: e.target.value })} /></label>
            </div>
            <datalist id="gr-lessons">{lessons.map((c) => <option key={c} value={c} />)}</datalist>
            <Area label="Explanation" hint="shown after every answer" rows={3} value={draft.explanation} onChange={(v) => setDraft({ explanation: v })} />
            <Area label="Examples" hint="one per line" rows={3} value={draft.examples.join("\n")} onChange={(v) => setDraft({ examples: v.split("\n") })} />
          </section>
          <section className="adm-editor-sec">
            <h4>Common mistakes <small className="adm-muted">({draft.commonMistakes.length})</small></h4>
            {draft.commonMistakes.map((m, i) => (
              <div key={i} className="gr-mistake">
                <input className="adm-input" aria-label={`Mistake ${i + 1}: wrong sentence`} placeholder="Wrong: I am agree." value={m.sentence || ""} onChange={(e) => setDraft((d) => ({ commonMistakes: d.commonMistakes.map((x, j) => (j === i ? { ...x, sentence: e.target.value } : x)) }))} />
                <input className="adm-input" aria-label={`Mistake ${i + 1}: correction`} placeholder="Right: I agree." value={m.correction || ""} onChange={(e) => setDraft((d) => ({ commonMistakes: d.commonMistakes.map((x, j) => (j === i ? { ...x, correction: e.target.value } : x)) }))} />
                <input className="adm-input" aria-label={`Mistake ${i + 1}: why`} placeholder="Why: agree is a verb." value={m.why || ""} onChange={(e) => setDraft((d) => ({ commonMistakes: d.commonMistakes.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)) }))} />
                <button className="adm-icon danger" aria-label={`Remove mistake ${i + 1}`} onClick={() => setDraft((d) => ({ commonMistakes: d.commonMistakes.filter((_, j) => j !== i) }))}><X size={15} /></button>
              </div>
            ))}
            <div><button className="adm-btn ghost small" onClick={() => setDraft((d) => ({ commonMistakes: [...d.commonMistakes, { sentence: "", correction: "", why: "" }] }))}><Plus size={14} /> Add a mistake</button>
              {draft.commonMistakes.length > 0 && <small className="adm-muted"> Rows missing any of the three parts aren't saved.</small>}</div>
          </section>
          <section className="adm-editor-sec">
            <h4>Questions <small className="adm-muted">({count})</small></h4>
            {!count && <p className="adm-muted">No questions yet. A rule needs at least one to be played.</p>}
            <ol className="gr-questions">
              {draft.questions.map((q, i) => (
                <QuestionCard key={i} q={q} index={i} total={count} problems={showErrors ? forQuestion(i) : []} preview={preview.has(i)}
                  onPreview={() => setPreview((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                  onChange={(nq) => setQuestion(i, nq)} onMove={(by) => moveQuestion(i, by)}
                  onDuplicate={() => setDraft((d) => ({ questions: [...d.questions.slice(0, i + 1), { ...d.questions[i], ...(d.questions[i].options ? { options: [...d.questions[i].options] } : {}) }, ...d.questions.slice(i + 1)] }))}
                  onRemove={() => setDraft((d) => ({ questions: d.questions.filter((_, j) => j !== i) }))} />
              ))}
            </ol>
            <div className="gr-add">
              <span className="adm-muted">Add a question:</span>
              {Object.entries(GRAMMAR_TYPES).map(([t, label]) => <button key={t} className="adm-btn ghost small" onClick={() => addQuestion(t)}><Plus size={14} /> {label}</button>)}
            </div>
            <AiQuestions rule={cleaned} content={content} onAdd={(qs) => { setDraft((d) => ({ questions: [...d.questions, ...qs] })); setNote({ text: `Added ${qs.length} question${qs.length === 1 ? "" : "s"}. Check them, then save.` }); }} />
          </section>
        </>}
        <footer className="adm-editor-foot">
          <button className="adm-btn primary" onClick={save} disabled={!dirty}>{isNew ? "Add rule" : "Save changes"}</button>
          {json == null && <button className="adm-btn ghost" onClick={() => setJson(JSON.stringify(cleaned, null, 2))}><Code2 size={15} /> JSON</button>}
          {!isNew && <button className="adm-btn ghost" onClick={() => onDuplicate(cleaned)}><Copy size={15} /> Duplicate</button>}
          <span className="adm-toolbar-spacer" />
          {!dirty || isNew ? null : <small className="adm-muted">Unsaved changes</small>}
          {!isNew && <button className="adm-btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>}
        </footer>
      </div>
      {confirmDelete && <ConfirmDialog danger title={`Delete “${rule.rule || rule.id}”?`} confirmLabel="Delete" body={<p>It disappears from every player's game. Their history with it stays in their progress. You can bring it back from the Activity log.</p>} onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onDelete(rule); }} />}
      {confirmClose && <ConfirmDialog danger title="Discard your changes?" confirmLabel="Discard" body={<p>The rule hasn't been saved.</p>} onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />}
    </Drawer>
  );
}

function QuestionCard({ q, index, total, problems, preview, onPreview, onChange, onMove, onDuplicate, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const options = q.options || [];
  const label = `Question ${index + 1}`;
  return (
    <li className={`gr-q ${problems.length ? "bad" : ""}`}>
      <header className="gr-q-head">
        <b>{index + 1}</b>
        <div className="adm-seg small" role="radiogroup" aria-label={`${label} type`}>
          {Object.entries(GRAMMAR_TYPES).map(([t, l]) => <button key={t} role="radio" aria-checked={q.type === t} onClick={() => q.type !== t && onChange({ ...blankGrammarQuestion(t), explanation: q.explanation || "" })}>{l}</button>)}
        </div>
        <span className="adm-toolbar-spacer" />
        <div className="adm-row-actions">
          <button className="adm-icon" onClick={onPreview} aria-label={preview ? `Hide preview of ${label}` : `Preview ${label}`} title="What the learner sees">{preview ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button className="adm-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}><ArrowUp size={15} /></button>
          <button className="adm-icon" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}><ArrowDown size={15} /></button>
          <button className="adm-icon" onClick={onDuplicate} aria-label={`Duplicate ${label}`}><Copy size={15} /></button>
          <button className="adm-icon danger" onClick={onRemove} aria-label={`Remove ${label}`}><Trash2 size={15} /></button>
        </div>
      </header>
      {problems.length > 0 && <ul className="gr-q-problems">{problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>}
      {preview ? <QuestionPreview q={q} /> : <>
        {q.type === "choose" && <>
          <Area label="Prompt" hint="use ______ for the gap" value={q.prompt || ""} onChange={(v) => set({ prompt: v })} />
          <div className="adm-field"><span>Options <small className="adm-muted">· tick the right one</small></span>
            <div className="gr-options">
              {options.map((o, j) => {
                const right = !!o.trim() && o.trim() === String(q.answer || "").trim();
                return (
                  <div key={j} className={`gr-option ${right ? "right" : ""}`}>
                    <button className="gr-tick" role="radio" aria-checked={right} aria-label={`Option ${j + 1} is the answer`} disabled={!o.trim()} onClick={() => set({ answer: o.trim() })}>{right && <Check size={14} />}</button>
                    <input className="adm-input" aria-label={`${label} option ${j + 1}`} value={o} onChange={(e) => { const opts = options.map((x, k) => (k === j ? e.target.value : x)); set({ options: opts, ...(right ? { answer: e.target.value.trim() } : {}) }); }} />
                    <button className="adm-icon danger" disabled={options.length <= 2} aria-label={`Remove option ${j + 1}`} onClick={() => set({ options: options.filter((_, k) => k !== j), ...(right ? { answer: "" } : {}) })}><X size={14} /></button>
                  </div>
                );
              })}
              {options.length < 6 && <button className="adm-link" onClick={() => set({ options: [...options, ""] })}><Plus size={13} /> Add an option</button>}
            </div>
          </div>
        </>}
        {q.type === "judge" && <>
          <Area label="Sentence" value={q.sentence || ""} onChange={(v) => set({ sentence: v })} />
          <div className="adm-seg" role="radiogroup" aria-label={`${label}: is the sentence correct?`}>
            <button role="radio" aria-checked={!q.correct} onClick={() => set({ correct: false, fix: q.fix || "", alternative: undefined })}>It has a mistake</button>
            <button role="radio" aria-checked={!!q.correct} onClick={() => set({ correct: true, alternative: q.alternative || "", fix: undefined })}>It's correct</button>
          </div>
          {q.correct
            ? <Area label="Other choice" hint="a tempting wrong rewrite, so the right answer isn't obvious" value={q.alternative || ""} onChange={(v) => set({ alternative: v })} />
            : <Area label="Fixed sentence" value={q.fix || ""} onChange={(v) => set({ fix: v })} />}
        </>}
        {q.type === "fix" && <div className="adm-form-grid">
          <Area label="Sentence with one mistake" value={q.sentence || ""} onChange={(v) => set({ sentence: v })} />
          <Area label="Corrected sentence" value={q.answer || ""} onChange={(v) => set({ answer: v })} />
        </div>}
        <Text label="Explanation" hint="optional; the rule's explanation is used when empty" value={q.explanation || ""} onChange={(v) => set({ explanation: v })} />
      </>}
    </li>
  );
}

// Roughly what the game shows: the prompt and the choices, right one marked.
export function QuestionPreview({ q }) {
  const choices = q.type === "choose" ? (q.options || []).filter((o) => o.trim()) : q.type === "judge" ? [JUDGE_OK, q.correct ? q.alternative : q.fix].filter(Boolean) : [];
  const right = q.type === "choose" ? q.answer : q.type === "judge" ? (q.correct ? JUDGE_OK : q.fix) : null;
  const prompt = q.type === "choose" ? q.prompt : q.type === "judge" ? `Is this sentence correct? If not, choose the fixed version.\n“${q.sentence || "…"}”` : `Fix the mistake and write the whole sentence:\n“${q.sentence || "…"}”`;
  return (
    <div className="gr-preview">
      <p>{prompt || <span className="adm-muted">No prompt yet</span>}</p>
      {choices.length > 0 && <div className="gr-preview-options">{choices.map((c, i) => <span key={i} className={c === right ? "right" : ""}>{c === right && <Check size={13} />}{c}</span>)}</div>}
      {q.type === "fix" && <p className="gr-preview-answer"><Check size={13} /> {q.answer || "…"}</p>}
      {q.explanation && <small>{q.explanation}</small>}
    </div>
  );
}

function AiQuestions({ rule, content, onAdd }) {
  const [types, setTypes] = useState(["choose", "judge", "fix"]);
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const selected = review ? review.filter((x) => x.ok && x.selected) : [];
  async function run() {
    if (!rule.rule || !rule.explanation) { setError("Write the rule and its explanation first: AI builds the questions from them."); return; }
    setBusy(true); setError(null); setReview(null);
    try {
      const lessonWords = (content.words || []).filter((w) => w.category === rule.category).slice(0, 40).map((w) => w.word);
      setReview(await generateGrammarQuestions(rule, types, count, lessonWords));
    } catch (e) { setError(e.message || "The AI request failed."); }
    setBusy(false);
  }
  return (
    <div className="gr-ai">
      <div className="gr-ai-row">
        <b><Sparkles size={15} /> Write questions with AI</b>
        {Object.entries(GRAMMAR_TYPES).map(([t, label]) => <label key={t} className="gr-check"><input type="checkbox" checked={types.includes(t)} onChange={() => setTypes((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))} /> {label}</label>)}
        <select className="adm-select" value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many">{[3, 6, 9].map((n) => <option key={n} value={n}>{n} questions</option>)}</select>
        <button className="adm-btn ghost" disabled={busy || !types.length} onClick={run}>{busy ? "Writing…" : "Generate"}</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {review && <div className="gr-ai-review">
        <p className="adm-muted">{review.filter((x) => x.ok).length} of {review.length} passed the checks. Pick the ones to add.</p>
        {review.map((it, i) => (
          <label key={i} className={`gr-ai-item ${it.ok ? "" : "failed"}`}>
            <input type="checkbox" disabled={!it.ok} checked={!!it.selected} onChange={() => setReview((r) => r.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))} />
            <div><Badge tone={it.ok ? "info" : "warning"}>{GRAMMAR_TYPES[it.question.type] || it.question.type}</Badge>{it.ok ? <QuestionPreview q={it.question} /> : <p className="adm-warn-text">Skipped: {it.reason}</p>}</div>
          </label>
        ))}
        <div className="adm-row"><button className="adm-btn primary" disabled={!selected.length} onClick={() => { onAdd(selected.map((x) => x.question)); setReview(null); }}>Add {selected.length} to this rule</button><button className="adm-btn ghost" onClick={() => setReview(null)}>Discard</button></div>
      </div>}
    </div>
  );
}
