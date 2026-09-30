import { useState } from "react";
import { Sparkles } from "lucide-react";
import { V2 } from "../../engine/v2";
import { callAiJsonAdmin } from "../../engine/ai";
// ── Admin: grammar rules ─────────────────────────────────────────────────
// Rules are edited as forms (no JSON). A rule saved from here is always in
// the v3 shape: questions[] of choose / judge / fix.
export const GRAMMAR_TYPES = { choose: "Choose", judge: "Right or Wrong?", fix: "Fix the Sentence" };
export const blankGrammarQuestion = (type) => type === "choose" ? { type, prompt: "", options: ["", "", ""], answer: "", explanation: "" } : type === "judge" ? { type, sentence: "", correct: false, fix: "", explanation: "" } : { type, sentence: "", answer: "", explanation: "" };
export function grammarDraftOf(g) {
  const { prompt, options, answer, ...rest } = g;
  return { ...rest, examples: Array.isArray(g.examples) ? g.examples : [], commonMistakes: Array.isArray(g.commonMistakes) ? g.commonMistakes : [], questions: (Array.isArray(g.questions) ? g.questions : V2.grammarQuestions(g)).map((q) => ({ ...q })) };
}
// Tidy a draft for saving: trim text, drop empty options/examples/mistakes.
export function cleanGrammarDraft(d) {
  const t = (x) => String(x ?? "").trim();
  const questions = d.questions.map((q) => {
    const base = { type: q.type, explanation: t(q.explanation) };
    if (q.type === "choose") return { ...base, prompt: t(q.prompt), options: (q.options || []).map(t).filter(Boolean), answer: t(q.answer) };
    if (q.type === "judge") return q.correct ? { ...base, sentence: t(q.sentence), correct: true, alternative: t(q.alternative) } : { ...base, sentence: t(q.sentence), correct: false, fix: t(q.fix) };
    return { ...base, sentence: t(q.sentence), answer: t(q.answer) };
  });
  return { ...d, id: t(d.id), rule: t(d.rule), category: t(d.category), level: t(d.level), explanation: t(d.explanation), examples: d.examples.map(t).filter(Boolean), commonMistakes: d.commonMistakes.map((m) => ({ sentence: t(m.sentence), correction: t(m.correction), why: t(m.why) })).filter((m) => m.sentence && m.correction && m.why), questions };
}
export function grammarDraftErrors(d, others) {
  const errors = V2.validateContent({ kind: "content", grammar: [d] }).map((e) => e.replace(/^grammar\[0\]\.?/, ""));
  if (!d.id) errors.push("id: expected non-empty string");
  else if (others.some((g) => g.id === d.id)) errors.push("id: another rule already uses this id");
  return errors;
}
export async function generateGrammarQuestions(rule, types, count, lessonWords) {
  const raw = await callAiJsonAdmin(`You write grammar practice for Word Hunter, an English game for Arabic-speaking learners (A2–B1). Use simple English only. Write ${count} NEW questions for the grammar rule in the input, using only these types: ${types.join(", ")}. Spread them across the types. Do not repeat or lightly reword existingQuestions. Where it fits naturally, use words or situations from lessonWords.
Types:
- choose: {"type":"choose","prompt":"sentence with ______ or a short question","options":["3 or 4 short options"],"answer":"exactly one of the options","explanation":"one short sentence"}. Exactly one option may be correct.
- judge: {"type":"judge","sentence":"...","correct":false,"fix":"the corrected sentence","explanation":"..."} for a sentence that breaks the rule, or {"type":"judge","sentence":"...","correct":true,"alternative":"a tempting WRONG rewrite of the same sentence","explanation":"..."} for a correct one. Mix correct and wrong sentences.
- fix: {"type":"fix","sentence":"a sentence with exactly one mistake about this rule","answer":"the corrected sentence","explanation":"..."}. Change as little as possible.
Every mistake must be about this rule, and every "correct" sentence must be fully correct English. Return ONLY JSON: {"questions":[...]}`, { rule: rule.rule, explanation: rule.explanation, level: rule.level || null, examples: rule.examples || [], existingQuestions: rule.questions || [], lessonWords }, 2500);
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  if (!list.length) throw new Error("AI didn't return any questions. Try again.");
  return list.map((q) => {
    const clean = cleanGrammarDraft({ id: "x", rule: "x", category: "x", explanation: "x", examples: [], commonMistakes: [], questions: [{ ...q, options: Array.isArray(q?.options) ? q.options : [] }] }).questions[0];
    const errors = types.includes(clean.type) ? V2.validateContent({ kind: "content", grammar: [{ id: "x", rule: "x", category: "x", explanation: "x", questions: [clean] }] }) : ["type not requested"];
    return { question: clean, ok: !errors.length, reason: errors.map((e) => e.replace(/^grammar\[0\]\.questions\[0\]\.?/, "")).join("; "), selected: !errors.length };
  });
}
export function GrammarQuestionEditor({ q, index, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const field = (label, key, multiline) => <label className="wh-grammar-field"><span>{label}</span>{multiline ? <textarea rows={2} value={q[key] || ""} onChange={(e) => set({ [key]: e.target.value })} /> : <input value={q[key] || ""} onChange={(e) => set({ [key]: e.target.value })} />}</label>;
  return <div className="wh-grammar-question">
    <div className="wh-grammar-qhead"><b>{index + 1}.</b><select value={q.type} onChange={(e) => onChange({ ...blankGrammarQuestion(e.target.value), explanation: q.explanation || "" })}>{Object.entries(GRAMMAR_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><button onClick={onRemove}>Remove</button></div>
    {q.type === "choose" && <>{field("Prompt", "prompt", true)}
      <label className="wh-grammar-field"><span>Options (one per line)</span><textarea rows={4} value={(q.options || []).join("\n")} onChange={(e) => set({ options: e.target.value.split("\n") })} /></label>
      <label className="wh-grammar-field"><span>Correct option</span><select value={q.answer || ""} onChange={(e) => set({ answer: e.target.value })}><option value="">— pick one —</option>{(q.options || []).map((o) => o.trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select></label></>}
    {q.type === "judge" && <>{field("Sentence", "sentence", true)}
      <label className="wh-grammar-field"><span>This sentence is</span><select value={q.correct ? "yes" : "no"} onChange={(e) => set({ correct: e.target.value === "yes" })}><option value="no">Wrong — learner picks the fix</option><option value="yes">Correct — learner keeps it</option></select></label>
      {q.correct ? field("Other choice (a tempting wrong rewrite)", "alternative", true) : field("Fixed sentence", "fix", true)}</>}
    {q.type === "fix" && <>{field("Sentence with one mistake", "sentence", true)}{field("Corrected sentence", "answer", true)}</>}
    {field("Explanation (shown after answering)", "explanation")}
  </div>;
}
export function GrammarPanel({ content, mastery, onUpdate }) {
  const rules = content.grammar || [];
  const categories = [...new Set([...(content.levels || []).map((l) => l.title), ...rules.map((g) => g.category).filter(Boolean)])];
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null); // {originalId|null, draft}
  const [aiTypes, setAiTypes] = useState(["choose", "judge", "fix"]);
  const [aiCount, setAiCount] = useState(3);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReview, setAiReview] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shown = rules.filter((g) => !filter || g.category === filter);
  const open = (g) => { setEditing({ originalId: g ? g.id : null, draft: g ? grammarDraftOf(g) : { id: `gr-${Date.now()}`, rule: "", category: filter || categories[0] || "", level: "", explanation: "", examples: [], commonMistakes: [], questions: [] } }); setAiReview(null); setError(null); setNotice(null); setConfirmDelete(false); };
  const draft = editing?.draft;
  const setDraft = (patch) => setEditing((e) => ({ ...e, draft: { ...e.draft, ...patch } }));
  const cleaned = draft ? cleanGrammarDraft(draft) : null;
  const errors = cleaned ? grammarDraftErrors(cleaned, rules.filter((g) => g.id !== editing.originalId)) : [];
  function save() {
    if (errors.length) return;
    const isNew = editing.originalId === null;
    // A new lesson name means the old category id no longer applies.
    const original = rules.find((g) => g.id === editing.originalId);
    const { categoryId, ...rest } = cleaned;
    if (categoryId && original?.category === rest.category) rest.categoryId = categoryId;
    if (!rest.level) delete rest.level;
    const next = isNew ? [...rules, rest] : rules.map((g) => (g.id === editing.originalId ? rest : g));
    onUpdate("grammar", next);
    setEditing({ originalId: rest.id, draft: grammarDraftOf(rest) });
    setNotice(isNew ? "Rule added." : "Saved.");
  }
  function remove() { onUpdate("grammar", rules.filter((g) => g.id !== editing.originalId)); setEditing(null); setNotice("Rule deleted. Its learning history stays in the backup."); }
  async function runAi() {
    if (!cleaned.rule || !cleaned.explanation) { setError("Write the rule and its explanation first — AI builds questions from them."); return; }
    setAiBusy(true); setError(null); setAiReview(null);
    try {
      const lessonWords = (content.words || []).filter((w) => w.category === cleaned.category).slice(0, 40).map((w) => w.word);
      setAiReview(await generateGrammarQuestions(cleaned, aiTypes, aiCount, lessonWords));
    } catch (e) { setError(e.message || "AI request failed."); }
    setAiBusy(false);
  }
  function addSelected() {
    const chosen = aiReview.filter((it) => it.ok && it.selected).map((it) => it.question);
    setDraft({ questions: [...draft.questions, ...chosen] });
    setAiReview(null);
    setNotice(`Added ${chosen.length} question${chosen.length === 1 ? "" : "s"} — press Save rule to keep them.`);
  }
  const progressOf = (g) => { const m = mastery?.[`grammar:${g.id}`]; return m?.total ? `${m.correct || 0}/${m.total} sessions right · last ${m.lastResult || "—"}` : "Not practised yet"; };
  const typeCounts = (g) => { const c = {}; for (const q of V2.grammarQuestions(g)) c[q.type] = (c[q.type] || 0) + 1; return Object.entries(c).map(([t, n]) => `${n} ${GRAMMAR_TYPES[t] || t}`).join(" · ") || "no questions"; };
  const selectedAi = aiReview ? aiReview.filter((it) => it.ok && it.selected).length : 0;
  return <div className="wh-admin-grid wh-grammar">
    <article className="wh-admin-card wh-grammar-list">
      <div className="wh-grammar-listhead"><h3>Rules <small>({shown.length})</small></h3><button className="primary" onClick={() => open(null)}>+ New rule</button></div>
      {categories.length > 0 && <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All lessons</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
      {!shown.length && <p>No grammar rules yet. Add one here or import a v3 file with a grammar array.</p>}
      {shown.map((g) => <button key={g.id} className={`wh-grammar-rule ${editing?.originalId === g.id ? "active" : ""}`} onClick={() => open(g)}>
        <b>{g.rule || g.id}</b><small>{g.category}{g.level ? ` · ${g.level}` : ""} · {typeCounts(g)}{!Array.isArray(g.questions) ? " · old format" : ""}</small><small>{progressOf(g)}</small>
      </button>)}
    </article>
    <article className="wh-admin-card wh-grammar-edit">
      {notice && <p className="wh-import-hint">{notice}</p>}
      {!draft ? <p>Pick a rule to see and edit its questions, or add a new one.</p> : <>
        <div className="wh-grammar-listhead"><h3>{editing.originalId === null ? "New rule" : "Edit rule"}</h3><div className="wh-import-actions">{editing.originalId !== null && (confirmDelete ? <><button onClick={() => setConfirmDelete(false)}>Keep</button><button className="danger" onClick={remove}>Delete for good</button></> : <button onClick={() => setConfirmDelete(true)}>Delete rule</button>)}<button className="primary" disabled={!!errors.length} onClick={save}>Save rule</button></div></div>
        {!Array.isArray(rules.find((g) => g.id === editing.originalId)?.questions) && editing.originalId !== null && <p className="wh-import-hint">Old single-question rule. Saving turns it into the new format (its question becomes the first "Choose" question).</p>}
        <div className="wh-grammar-row2">
          <label className="wh-grammar-field"><span>Rule</span><input value={draft.rule} onChange={(e) => setDraft({ rule: e.target.value })} placeholder="e.g. Going to (plans and predictions)" /></label>
          <label className="wh-grammar-field"><span>Id (progress key)</span><input value={draft.id} disabled={editing.originalId !== null} onChange={(e) => setDraft({ id: e.target.value })} /></label>
          <label className="wh-grammar-field"><span>Lesson</span><input list="wh-grammar-cats" value={draft.category} onChange={(e) => setDraft({ category: e.target.value })} /><datalist id="wh-grammar-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className="wh-grammar-field"><span>Level</span><select value={draft.level || ""} onChange={(e) => setDraft({ level: e.target.value })}><option value="">—</option>{["A1", "A2", "B1", "B2", "C1"].map((l) => <option key={l}>{l}</option>)}</select></label>
        </div>
        <label className="wh-grammar-field"><span>Explanation</span><textarea rows={3} value={draft.explanation} onChange={(e) => setDraft({ explanation: e.target.value })} /></label>
        <label className="wh-grammar-field"><span>Examples (one per line)</span><textarea rows={3} value={draft.examples.join("\n")} onChange={(e) => setDraft({ examples: e.target.value.split("\n") })} /></label>
        <h4>Questions ({draft.questions.length})</h4>
        {draft.questions.map((q, i) => <GrammarQuestionEditor key={i} q={q} index={i} onChange={(nq) => setDraft({ questions: draft.questions.map((x, j) => (j === i ? nq : x)) })} onRemove={() => setDraft({ questions: draft.questions.filter((_, j) => j !== i) })} />)}
        <div className="wh-import-actions">{Object.entries(GRAMMAR_TYPES).map(([t, label]) => <button key={t} onClick={() => setDraft({ questions: [...draft.questions, blankGrammarQuestion(t)] })}>+ {label}</button>)}</div>
        <div className="wh-grammar-ai">
          <h4>Add questions with AI</h4>
          <div className="wh-import-actions">{Object.entries(GRAMMAR_TYPES).map(([t, label]) => <label key={t} className="wh-grammar-check"><input type="checkbox" checked={aiTypes.includes(t)} onChange={() => setAiTypes((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))} /> {label}</label>)}
            <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>{[3, 6, 9].map((n) => <option key={n} value={n}>{n} questions</option>)}</select>
            <button className="primary" disabled={aiBusy || !aiTypes.length} onClick={runAi}><Sparkles size={13} /> {aiBusy ? "Writing…" : "Generate"}</button></div>
          {aiReview && <div className="wh-health-review">
            <h4>Review — {selectedAi} selected</h4>
            {aiReview.map((it, i) => <label key={i} className={`wh-health-item ${it.ok ? "" : "failed"}`}>
              <input type="checkbox" disabled={!it.ok} checked={!!it.selected} onChange={() => setAiReview((r) => r.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))} />
              <div><b>{GRAMMAR_TYPES[it.question.type] || it.question.type}</b>{it.ok ? <GrammarQuestionPreview q={it.question} /> : <p className="before">Skipped: {it.reason}</p>}</div>
            </label>)}
            <div className="wh-import-actions"><button onClick={() => setAiReview(null)}>Discard all</button><button className="primary" disabled={!selectedAi} onClick={addSelected}>Add {selectedAi} to this rule</button></div>
          </div>}
        </div>
        {error && <div className="wh-import-error">{error}</div>}
        {errors.length > 0 && <div className="wh-import-error">Fix before saving:<br />{errors.slice(0, 6).map((e) => <span key={e}>• {e}<br /></span>)}</div>}
      </>}
    </article>
  </div>;
}
export function GrammarQuestionPreview({ q }) {
  if (q.type === "choose") return <><p>{q.prompt}</p><p>{q.options.map((o) => (o === q.answer ? `✓ ${o}` : o)).join("  ·  ")}</p><p className="after">{q.explanation}</p></>;
  if (q.type === "judge") return <><p>“{q.sentence}” — {q.correct ? "correct" : "wrong"}</p><p className={q.correct ? "before" : "after"}>{q.correct ? `Other choice: ${q.alternative}` : `Fix: ${q.fix}`}</p><p className="after">{q.explanation}</p></>;
  return <><p className="before">{q.sentence}</p><p className="after">{q.answer}</p><p>{q.explanation}</p></>;
}
