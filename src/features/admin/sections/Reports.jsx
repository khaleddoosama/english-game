import { useMemo, useState } from "react";
import { BookOpen, CheckCheck, FileJson, RotateCcw, Sparkles, Trash2, User, Wrench } from "lucide-react";
import { useQuery } from "../../../lib/router";
import { V2 } from "../../../engine/v2";
import { locateReportSource, suggestReportFix } from "../../../engine/ai";
import { DataTable, downloadText } from "../DataTable";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice, fmtDate, relTime } from "../adminUi";
import { DiffTable, fieldChanges } from "../diff";

const VERDICT_TONE = { flawed: "danger", repeated: "warning", fine: "success", unsure: "neutral" };
const VERDICT_TEXT = { flawed: "real problem", repeated: "keeps repeating", fine: "question looks OK", unsure: "AI unsure" };
const ENTITY_LABEL = { words: "word", grammar: "grammar rule", stories: "story", combos: "combo", challenges: "challenge" };
const fullDate = (t) => (t ? new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

// One shape for new reports (with question/session/reporter) and older
// flat ones.
export function reportView(r, i = 0) {
  const q = r.question || {};
  const answer = r.learnerAnswer;
  const answerList = answer == null ? [] : Array.isArray(answer) ? answer.map(String) : typeof answer === "object" ? (answer.selected || [answer.text].filter(Boolean)).map(String) : [String(answer)];
  return {
    raw: r,
    key: r.id || `idx-${i}`,
    id: r.id || null,
    prompt: q.prompt ?? r.prompt ?? r.questionId ?? "",
    mode: q.mode ?? r.mode ?? null,
    type: q.type ?? r.type ?? null,
    options: q.options ?? r.options ?? null,
    answers: q.answers ?? r.answers ?? [],
    targets: q.targets ?? r.targetWords ?? [],
    explanation: q.explanation ?? null,
    hasPicture: !!q.hasPicture,
    playerAnswer: r.learnerAnswerText ?? (answerList.length ? answerList.join(" + ") : null),
    answerList,
    wasCorrect: typeof r.wasCorrect === "boolean" ? r.wasCorrect : null,
    submitted: r.answerSubmitted ?? (answer != null),
    reason: r.reason || null,
    note: r.details || null,
    reporter: r._from || r.reporter?.username || "you",
    filedAt: r.at || (r._filedAt ? Date.parse(r._filedAt) : null),
    session: r.session || (r.sessionId ? { id: r.sessionId } : null),
    questionId: q.id ?? r.questionId ?? null,
    pool: r.poolType ? `${r.poolType} / ${r.poolItemId}` : null,
    resolvedAt: r.resolvedAt || null,
    verdict: r.aiReview?.verdict || "",
    aiReview: r.aiReview || null,
    timeZone: r.timeZone || null,
  };
}

export function Reports({ reports, content, onResolve, onReopen, onDelete, onRetire, onReviewReport, onUpdate, openKey, onOpen, onOpenWord, onOpenPlayer }) {
  const [f, setF] = useQuery({ status: "open", from: "", verdict: "", reason: "" });
  const { status, from, verdict, reason } = f;
  const [confirm, setConfirm] = useState(null);
  const [bulk, setBulk] = useState(null); // AI review progress
  const views = useMemo(() => reports.map(reportView), [reports]);
  const players = useMemo(() => [...new Set(views.map((r) => r.reporter))].sort(), [views]);
  const reasons = useMemo(() => [...new Set(views.map((r) => r.reason).filter(Boolean))].sort(), [views]);
  const rows = useMemo(() => views.filter((r) => (status === "all" || (status === "open" ? !r.resolvedAt : !!r.resolvedAt))
    && (!from || r.reporter === from) && (!reason || r.reason === reason) && (!verdict || (verdict === "none" ? !r.verdict : r.verdict === verdict))), [views, status, from, verdict, reason]);
  const open = views.filter((r) => !r.resolvedAt);
  const current = openKey ? views.find((r) => r.key === openKey) : null;

  const columns = [
    { key: "filedAt", label: "Filed", defaultDir: "desc", sortValue: (r) => r.filedAt || 0, csv: (r) => (r.filedAt ? new Date(r.filedAt).toISOString() : ""), render: (r) => <span title={fullDate(r.filedAt)}>{fmtDate(r.filedAt)}</span> },
    { key: "prompt", label: "Question", render: (r) => <span className="adm-word"><b>{r.prompt}</b><small>{r.mode || "question"}{r.targets.length ? ` · ${r.targets.join(", ")}` : ""}</small></span> },
    { key: "playerAnswer", label: "Their answer", csv: (r) => r.playerAnswer || "", render: (r) => (r.playerAnswer ? <span className={r.wasCorrect === true ? "adm-good" : r.wasCorrect === false ? "adm-bad" : ""}>{r.playerAnswer}{!r.submitted && <small className="adm-muted"> (not submitted)</small>}</span> : <span className="adm-muted">—</span>) },
    { key: "reason", label: "Reason", csv: (r) => [r.reason, r.note].filter(Boolean).join(" — "), render: (r) => <span className="adm-word"><span>{r.reason || <span className="adm-muted">—</span>}</span>{r.note && <small>“{r.note}”</small>}</span> },
    { key: "reporter", label: "From" },
    { key: "verdict", label: "AI check", render: (r) => (r.verdict ? <Badge tone={VERDICT_TONE[r.verdict] || "neutral"}>{r.verdict}</Badge> : <span className="adm-muted">not checked</span>) },
    { key: "status", label: "Status", sortValue: (r) => (r.resolvedAt ? 1 : 0), csv: (r) => (r.resolvedAt ? "resolved" : "open"), render: (r) => (r.resolvedAt ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge>) },
  ];

  async function reviewAll() {
    const pending = open.filter((r) => !r.aiReview).map((r) => r.raw);
    setBulk({ done: 0, total: pending.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < pending.length; i++) {
      try { await onReviewReport(pending[i]); } catch { failed++; }
      setBulk({ done: i + 1, total: pending.length, failed });
    }
  }
  const unreviewed = open.filter((r) => !r.aiReview).length;
  const reviewing = bulk && bulk.done < bulk.total;

  return (
    <div className="adm-section">
      <div className="adm-kpis compact">
        <Kpi label="Open" value={open.length} tone={open.length ? "attention" : ""} />
        <Kpi label="AI says flawed" value={open.filter((r) => r.verdict === "flawed").length} />
        <Kpi label="Not AI-checked" value={unreviewed} />
        <Kpi label="Resolved" value={views.length - open.length} />
      </div>
      <Notice>An open report keeps that word and question type out of every player's rounds. Resolving or retiring it lifts the block.</Notice>
      {bulk && !reviewing && <Notice tone={bulk.failed ? "error" : "info"}>AI reviewed {bulk.total - bulk.failed} of {bulk.total} reports{bulk.failed ? `; ${bulk.failed} failed, try again later` : ""}.</Notice>}
      <DataTable
        id="reports" columns={columns} rows={rows} rowKey={(r) => r.key} csvName="word-hunter-reports"
        searchText={(r) => `${r.prompt} ${r.targets.join(" ")} ${r.reason || ""} ${r.note || ""} ${r.playerAnswer || ""} ${r.reporter}`} searchPlaceholder="Search question, word, answer, reason…"
        initialSort={{ key: "filedAt", dir: "desc" }} resetKey={`${status}|${from}|${verdict}|${reason}`} syncUrl selectable onRowClick={(r) => onOpen(r.key)}
        filters={<>
          <select className="adm-select" value={status} onChange={(e) => setF({ status: e.target.value, page: null })} aria-label="Status"><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select>
          <select className="adm-select" value={verdict} onChange={(e) => setF({ verdict: e.target.value, page: null })} aria-label="AI verdict"><option value="">Any AI verdict</option><option value="flawed">Flawed</option><option value="repeated">Repeated</option><option value="fine">Fine</option><option value="unsure">Unsure</option><option value="none">Not checked</option></select>
          {reasons.length > 0 && <select className="adm-select" value={reason} onChange={(e) => setF({ reason: e.target.value, page: null })} aria-label="Reason"><option value="">Any reason</option>{reasons.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
          {players.length > 1 && <select className="adm-select" value={from} onChange={(e) => setF({ from: e.target.value, page: null })} aria-label="Filed by"><option value="">Anyone</option>{players.map((p) => <option key={p} value={p}>{p}</option>)}</select>}
        </>}
        toolbar={unreviewed > 0 && onReviewReport && <button className="adm-btn ghost" disabled={reviewing} onClick={reviewAll}><Sparkles size={15} /> {reviewing ? `AI reviewing ${bulk.done}/${bulk.total}…` : `AI review ${unreviewed} open`}</button>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" disabled={!sel.some((r) => !r.resolvedAt)} onClick={() => { sel.filter((r) => !r.resolvedAt).forEach((r) => onResolve(r.raw)); clear(); }}><CheckCheck size={15} /> Resolve</button>
          <button className="adm-btn ghost" onClick={() => downloadText(`word-hunter-reports-${sel.length}.json`, JSON.stringify({ kind: "word-hunter-reports", exportedAt: new Date().toISOString(), reports: sel.map((r) => r.raw) }, null, 2), "application/json")}><FileJson size={15} /> Export JSON</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ rows: sel, clear })}><Trash2 size={15} /> Delete</button>
        </>}
        emptyText="No reports. Players report questions from inside a round."
      />
      {current && <ReportDrawer report={current} content={content} onClose={() => onOpen(null)} onResolve={onResolve} onReopen={onReopen} onDelete={(r) => setConfirm({ rows: [r], clear: () => onOpen(null) })}
        onRetire={onRetire} onReviewReport={onReviewReport} onUpdate={onUpdate} onOpenWord={onOpenWord} onOpenPlayer={onOpenPlayer} />}
      {openKey && !current && <Drawer title="Report not found" onClose={() => onOpen(null)}><p>This report no longer exists. It may have been deleted.</p></Drawer>}
      {confirm && <ConfirmDialog title={`Delete ${confirm.rows.length} report${confirm.rows.length === 1 ? "" : "s"}?`} danger confirmLabel="Delete"
        body={<p>Deleted reports stop blocking their question. Resolving keeps a record instead.</p>}
        onCancel={() => setConfirm(null)} onConfirm={() => { confirm.rows.forEach((r) => onDelete(r.raw)); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}

function ReportDrawer({ report: r, content, onClose, onResolve, onReopen, onDelete, onRetire, onReviewReport, onUpdate, onOpenWord, onOpenPlayer }) {
  const [fix, setFix] = useState(null); // { entity, before, after, changes }
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const norm = (x) => V2.norm(String(x));
  const isRight = (opt) => (r.answers || []).some((a) => norm(a) === norm(opt));
  const isPicked = (opt) => r.answerList.some((a) => norm(a) === norm(opt));
  const source = useMemo(() => { try { return locateReportSource(content, r.raw); } catch { return null; } }, [content, r.raw]);

  async function suggest() {
    setError(null); setFix(null);
    if (!source) { setError("Couldn't find the content this question came from. It may have been edited or deleted."); return; }
    setBusy("fix");
    try { const result = await suggestReportFix(r.raw, source.item, source.entity); setFix({ entity: source.entity, before: source.item, after: result.fixed, changes: result.changes || [] }); }
    catch (e) { setError(e.message || "AI couldn't suggest a fix."); }
    setBusy(null);
  }
  function stored() {
    if (!r.aiReview?.fixed || !source) { setError("The drafted fix no longer matches any content. Ask AI for a new one."); return; }
    setFix({ entity: source.entity, before: source.item, after: r.aiReview.fixed, changes: r.aiReview.changes || [] });
  }
  function apply() {
    const keyField = fix.entity === "words" ? "word" : "id";
    const list = content[fix.entity] || [];
    onUpdate(fix.entity, list.map((x) => (norm(x[keyField]) === norm(fix.after[keyField]) ? fix.after : x)));
    onResolve(r.raw);
    setFix(null);
  }
  async function review() {
    setBusy("review"); setError(null);
    try { await onReviewReport(r.raw); } catch (e) { setError(e.message || "AI review failed."); }
    setBusy(null);
  }

  return (
    <Drawer title="Reported question" subtitle={`Filed ${fullDate(r.filedAt)} by ${r.reporter}`} onClose={onClose}
      actions={r.resolvedAt ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge>}>
      <div className="adm-report">
        <section>
          <h4>Question <span className="adm-tags"><Badge>{r.mode || "question"}</Badge>{r.type && <Badge>{r.type}</Badge>}{r.hasPicture && <Badge>picture</Badge>}</span></h4>
          <p className="adm-report-prompt">{r.prompt}</p>
          {r.options?.length > 0 ? (
            <ul className="adm-report-options">
              {r.options.map((opt) => {
                const right = isRight(opt), picked = isPicked(opt);
                return <li key={opt} className={`${right ? "right" : ""} ${picked ? "picked" : ""}`}><span>{opt}</span>{right && <small>right answer</small>}{picked && <small>{right ? "their pick ✓" : "their pick ✗"}</small>}</li>;
              })}
            </ul>
          ) : <p><b>Right answer{r.answers.length > 1 ? "s" : ""}:</b> {r.answers.join(" / ") || "—"}</p>}
          {r.explanation && <p className="adm-muted">{r.explanation}</p>}
        </section>
        <section className="adm-report-grid">
          <div><h5>Their answer</h5><p>{r.playerAnswer ? <span className={r.wasCorrect === true ? "adm-good" : r.wasCorrect === false ? "adm-bad" : ""}>{r.playerAnswer}</span> : <span className="adm-muted">none</span>}</p>
            <small className="adm-muted">{!r.submitted ? (r.playerAnswer ? "chosen, not submitted" : "reported before answering") : r.wasCorrect === true ? "marked right" : r.wasCorrect === false ? "marked wrong" : "submitted"}</small></div>
          <div><h5>Reason</h5><p>{r.reason || <span className="adm-muted">none given</span>}</p>{r.note && <blockquote>{r.note}</blockquote>}</div>
          <div><h5>Reported by</h5><p><button className="adm-link" onClick={() => onOpenPlayer(r.reporter)}><User size={13} /> {r.reporter}</button></p><small className="adm-muted">{fullDate(r.filedAt)} · {relTime(r.filedAt)}{r.timeZone ? ` · ${r.timeZone}` : ""}</small></div>
          <div><h5>Where</h5><p>{r.session?.title || "a round"}{r.session?.index != null ? ` · question ${r.session.index + 1}${r.session.total ? ` of ${r.session.total}` : ""}` : ""}</p><small className="adm-muted">{[r.session?.kind, r.questionId && `id ${r.questionId}`, r.pool && `pool ${r.pool}`].filter(Boolean).join(" · ")}</small></div>
        </section>
        <section>
          <h4><Sparkles size={14} /> AI check</h4>
          {r.aiReview ? <>
            <p><Badge tone={VERDICT_TONE[r.verdict] || "neutral"}>{VERDICT_TEXT[r.verdict] || r.verdict}</Badge> {r.aiReview.confidence && <small className="adm-muted">confidence {r.aiReview.confidence}</small>}</p>
            {r.aiReview.adminNote && <p>{r.aiReview.adminNote}</p>}
            {r.aiReview.explanation && <p className="adm-muted">Told the player: {r.aiReview.explanation}</p>}
            {r.aiReview.learnerAnswerAcceptable != null && <p className="adm-muted">Their answer: {r.aiReview.learnerAnswerAcceptable ? "acceptable" : "not acceptable"}</p>}
          </> : <p className="adm-muted">Not checked yet.</p>}
          <div className="adm-row">
            {onReviewReport && <button className="adm-btn ghost" disabled={!!busy} onClick={review}>{busy === "review" ? "Checking…" : r.aiReview ? "Check again" : "Ask AI to check"}</button>}
            {!r.resolvedAt && r.aiReview?.fixed && <button className="adm-btn primary" onClick={stored}><Wrench size={15} /> Review drafted fix</button>}
            {!r.resolvedAt && <button className="adm-btn ghost" disabled={!!busy} onClick={suggest}><Sparkles size={15} /> {busy === "fix" ? "Asking AI…" : "Suggest a fix"}</button>}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {fix && <div className="adm-fix">
            <p><b>AI suggests these changes to the {ENTITY_LABEL[fix.entity] || fix.entity}:</b></p>
            {fix.changes.length > 0 && <ul>{fix.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            <DiffTable rows={fieldChanges(fix.before, fix.after)} />
            <div className="adm-row"><button className="adm-btn primary" onClick={apply}>Apply fix and resolve</button><button className="adm-btn ghost" onClick={() => setFix(null)}>Discard</button></div>
          </div>}
        </section>
        <footer className="adm-row adm-report-actions">
          {r.resolvedAt ? <button className="adm-btn ghost" onClick={() => onReopen(r.raw)}><RotateCcw size={15} /> Reopen</button> : <button className="adm-btn primary" onClick={() => onResolve(r.raw)}><CheckCheck size={15} /> Resolve</button>}
          {!r.resolvedAt && r.pool && <button className="adm-btn ghost" onClick={() => onRetire(r.raw)} title="Never use this sentence again and write a new one">Retire this sentence</button>}
          {r.targets[0] && source?.entity === "words" && <button className="adm-btn ghost" onClick={() => onOpenWord(source.item.word)}><BookOpen size={15} /> Edit the word</button>}
          <span className="adm-toolbar-spacer" />
          <button className="adm-btn danger" onClick={() => onDelete(r)}><Trash2 size={15} /> Delete</button>
        </footer>
        {r.resolvedAt && <p className="adm-muted">Resolved {fullDate(r.resolvedAt)}.</p>}
      </div>
    </Drawer>
  );
}
