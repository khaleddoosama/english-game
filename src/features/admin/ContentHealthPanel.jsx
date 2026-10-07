import { runAiOperation, updateAiOperation, isAiCancelled } from "../../lib/aiOperations.js";
import { useCancelAiOnLeave } from "../../lib/aiLifecycle.js";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { HEALTH_CHECKS, aiFixWordBatch, findCategoryDuplicates, gapsKey, gapsOf, scanContentHealth } from "../../engine/ai";
export function formatHealthValue(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(value.some((x) => String(x).length > 30) ? "  ·  " : ", ");
  if (typeof value === "object") return `✗ ${value.sentence}  →  ✓ ${value.correction}  (${value.why})`;
  return String(value);
}
export const HEALTH_BATCH = 5, HEALTH_RUN = 20;
export function ContentHealthPanel({ content, onUpdate, onMergeCategories, onRemoveEmptyLevels }) {
  useCancelAiOnLeave(["Fix word content"]);
  const words = content.words || [];
  const issues = useMemo(() => scanContentHealth(words), [words]);
  const [run, setRun] = useState(null); // {kind, done, total}
  const [review, setReview] = useState(null); // {kind, items:[{word, ok, field, before, after, reason, selected}]}
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const entityIds = ["words", "grammar", "combos", "challenges", "stories"];
  const counts = {};
  for (const id of entityIds) for (const item of content[id] || []) if (item.category) counts[item.category] = (counts[item.category] || 0) + 1;
  const levelTitles = (content.levels || []).map((l) => l.title);
  const duplicates = findCategoryDuplicates([...levelTitles, ...Object.keys(counts)], counts);
  const emptyLevels = levelTitles.filter((t) => !counts[t]);
  async function start(kind) {
    const targets = issues[kind].slice(0, HEALTH_RUN);
    if (!targets.length || run) return;
    setError(null); setNotice(null); setReview(null); setRun({ kind, done: 0, total: targets.length });
    const items = [];
    try {
      await runAiOperation("Fix word content", async signal => {
        updateAiOperation(signal, { done: 0, total: targets.length, phase: "Reviewing word content" });
        for (let i = 0; i < targets.length; i += HEALTH_BATCH) {
          signal.throwIfAborted();
          const batch = targets.slice(i, i + HEALTH_BATCH);
          try { items.push(...(await aiFixWordBatch(kind, batch, words, { signal }))); }
          catch (e) { if (isAiCancelled(e)) throw e; items.push(...batch.map(w => ({ word: w.word, ok: false, reason: e.message || "AI request failed." }))); }
          const done = Math.min(targets.length, i + HEALTH_BATCH);
          setRun({ kind, done, total: targets.length });
          updateAiOperation(signal, { done, total: targets.length });
        }
      }, { timeoutMs: 240000 });
    } catch (e) {
      if (isAiCancelled(e)) setNotice("Stopped. Completed suggestions are available below; no changes were applied.");
      else setError(e.message || "AI couldn't finish the batch.");
    }
    setRun(null);
    setReview({ kind, items: items.filter((it) => !it.fine).map((it) => ({ ...it, selected: it.ok })), fine: items.filter((it) => it.fine).map((it) => it.word) });
  }
  function apply() {
    const chosen = review.items.filter((it) => it.ok && it.selected);
    const fine = new Set(review.fine || []);
    if (!chosen.length && !fine.size) { setReview(null); return; }
    const byWord = new Map(chosen.map((it) => [it.word, it]));
    onUpdate("words", words.map((w) => {
      let next = byWord.has(w.word) ? { ...w, [byWord.get(w.word).field]: byWord.get(w.word).after, ...(byWord.get(w.word).extra || {}) } : w;
      // v3 lists feed the questions, so the fix goes into them too.
      const fix = byWord.get(w.word);
      if (fix?.field === "situation" && Array.isArray(w.situations)) next.situations = [fix.after, ...w.situations.slice(1)];
      if (fix?.field === "commonMistake" && Array.isArray(w.commonMistakes)) next.commonMistakes = [fix.after, ...w.commonMistakes];
      if (fix?.field === "gaps") { next.gap = fix.after[0]; next.gapsCheckedFor = gapsKey(fix.after); }
      if (fine.has(w.word)) next = { ...next, gapsCheckedFor: gapsKey(gapsOf(w)) };
      return next;
    }));
    setNotice(`Applied ${chosen.length} fix${chosen.length === 1 ? "" : "es"}.${fine.size ? ` ${fine.size} word${fine.size === 1 ? "" : "s"} marked as checked (gaps were clear).` : ""}`);
    setReview(null);
  }
  const toggle = (index) => setReview((r) => ({ ...r, items: r.items.map((it, i) => (i === index ? { ...it, selected: !it.selected } : it)) }));
  const selectedCount = review ? review.items.filter((it) => it.ok && it.selected).length : 0;
  return <div className="wh-admin-grid wh-health">
    <article className="wh-admin-card wh-health-wide">
      <h3>Word content</h3>
      <p>AI fixes up to {HEALTH_RUN} words per run. You review every change and apply only what you tick, so nothing changes by itself.</p>
      {notice && <p className="wh-import-hint">{notice}</p>}
      {error && <div className="wh-import-error">{error}</div>}
      <div className="wh-health-list">{Object.entries(HEALTH_CHECKS).map(([kind, check]) => {
        const n = issues[kind]?.length || 0;
        const busy = run?.kind === kind;
        return <div key={kind} className={`wh-health-row ${n ? "" : "clean"}`}>
          <div><b>{check.label}</b><small>{check.help}</small></div>
          <span className="wh-health-count">{n}</span>
          <button className="wh-import-btn primary" disabled={!n || !!run || !!review} onClick={() => start(kind)}><Sparkles size={13} /> {busy ? `Fixing… ${run.done}/${run.total}` : n ? `Fix ${Math.min(n, HEALTH_RUN)} with AI` : "All good"}</button>
        </div>;
      })}</div>
      {review && <div className="wh-health-review">
        <h4>Review: {HEALTH_CHECKS[review.kind].label} — {selectedCount} selected</h4>
        {review.fine?.length > 0 && <p className="wh-import-hint">{review.fine.length} word{review.fine.length === 1 ? "" : "s"} had clear gaps: {review.fine.join(", ")}. They're marked as checked when you apply.</p>}
        {review.items.map((it, i) => <label key={it.word} className={`wh-health-item ${it.ok ? "" : "failed"}`}>
          <input type="checkbox" disabled={!it.ok} checked={!!it.selected} onChange={() => toggle(i)} />
          <div><b>{it.word}</b>{it.ok ? <><p className="before">{formatHealthValue(it.shownBefore ?? it.before)}</p><p className="after">{formatHealthValue(it.shownAfter ?? it.after)}</p>{it.reason && <p><small>{it.reason}</small></p>}{it.extra?.antonyms && <p className="after">+ Opposite: {it.extra.antonyms.at(-1)}</p>}</> : <p className="before">Skipped: {it.reason}</p>}</div>
        </label>)}
        <div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={() => setReview(null)}>Discard all</button><button className="wh-import-btn primary" disabled={!selectedCount && !review.fine?.length} onClick={apply}>{selectedCount ? `Apply ${selectedCount} selected` : `Mark ${review.fine?.length || 0} as checked`}</button></div>
      </div>}
    </article>
    <article className="wh-admin-card">
      <h3>Duplicate categories</h3>
      <p>Same topic written two ways. Merging moves every word, grammar rule, combo, challenge and story to one name and removes the extra level.</p>
      {!duplicates.length ? <p>No duplicates found.</p> : duplicates.map((d) => <div key={d.canonical} className="wh-health-row">
        <div><b>{d.canonical}</b> <small>({counts[d.canonical] || 0} items) ← {d.duplicates.map((x) => `${x} (${counts[x] || 0})`).join(", ")}</small></div>
        <button className="wh-import-btn primary" onClick={() => { onMergeCategories(d.canonical, d.duplicates); setNotice(`Merged into "${d.canonical}".`); }}>Merge</button>
      </div>)}
    </article>
    <article className="wh-admin-card">
      <h3>Empty levels</h3>
      <p>Levels with no content at all. They show up in Practice with nothing to practise.</p>
      {!emptyLevels.length ? <p>No empty levels.</p> : <><p>{emptyLevels.join(", ")}</p><button className="wh-import-btn primary" onClick={() => { const removed = onRemoveEmptyLevels(); setNotice(`Removed ${removed} empty level${removed === 1 ? "" : "s"}.`); }}>Remove {emptyLevels.length} empty level{emptyLevels.length === 1 ? "" : "s"}</button></>}
    </article>
  </div>;
}
