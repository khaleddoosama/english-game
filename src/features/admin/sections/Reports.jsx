import { useMemo, useState } from "react";
import { CheckCheck, FileJson, Trash2, Wrench } from "lucide-react";
import { DataTable, downloadText } from "../DataTable";
import { Badge, ConfirmDialog, Kpi, fmtDate, relTime } from "../adminUi";

const VERDICT_TONE = { flawed: "danger", repeated: "warning", fine: "success", unsure: "neutral" };

export function Reports({ reports, onResolve, onDelete, onReview }) {
  const [status, setStatus] = useState("open");
  const [from, setFrom] = useState("");
  const [verdict, setVerdict] = useState("");
  const [confirm, setConfirm] = useState(null);
  const players = useMemo(() => [...new Set(reports.map((r) => r._from || "you"))].sort(), [reports]);
  const rows = useMemo(() => reports.map((r, i) => ({ ...r, _key: r.id || `idx-${i}`, _who: r._from || "you", _verdict: r.aiReview?.verdict || "" }))
    .filter((r) => (status === "all" || (status === "open" ? !r.resolvedAt : !!r.resolvedAt)) && (!from || r._who === from) && (!verdict || (verdict === "none" ? !r._verdict : r._verdict === verdict))), [reports, status, from, verdict]);
  const open = reports.filter((r) => !r.resolvedAt);

  const columns = [
    { key: "prompt", label: "Question", render: (r) => <span className="adm-word"><b>{r.prompt || r.questionId}</b>{r.details && <small>“{r.details}”</small>}</span> },
    { key: "targetWords", label: "Word", sortValue: (r) => (r.targetWords || []).join(", "), render: (r) => (r.targetWords || []).join(", ") || "—" },
    { key: "mode", label: "Mode", render: (r) => <Badge>{r.mode || "question"}</Badge> },
    { key: "reason", label: "Reason" },
    { key: "_who", label: "From" },
    { key: "at", label: "Filed", defaultDir: "desc", sortValue: (r) => r.at || 0, csv: (r) => (r.at ? new Date(r.at).toISOString() : ""), render: (r) => <span title={fmtDate(r.at)}>{relTime(r.at)}</span> },
    { key: "_verdict", label: "AI check", render: (r) => (r._verdict ? <Badge tone={VERDICT_TONE[r._verdict] || "neutral"}>{r._verdict}</Badge> : <span className="adm-muted">not checked</span>) },
    { key: "status", label: "Status", sortValue: (r) => (r.resolvedAt ? 1 : 0), csv: (r) => (r.resolvedAt ? "resolved" : "open"), render: (r) => (r.resolvedAt ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge>) },
    { key: "act", label: "", sortable: false, csv: false, render: (r) => <button className="adm-btn ghost small" onClick={() => onReview(r)}><Wrench size={14} /> Review &amp; fix</button> },
  ];

  return (
    <div className="adm-section">
      <div className="adm-kpis compact">
        <Kpi label="Open" value={open.length} tone={open.length ? "attention" : ""} />
        <Kpi label="AI says flawed" value={open.filter((r) => r.aiReview?.verdict === "flawed").length} />
        <Kpi label="Not AI-checked" value={open.filter((r) => !r.aiReview).length} />
        <Kpi label="Resolved" value={reports.length - open.length} />
      </div>
      <DataTable
        id="reports" columns={columns} rows={rows} rowKey={(r) => r._key} csvName="word-hunter-reports"
        searchText={(r) => `${r.prompt} ${(r.targetWords || []).join(" ")} ${r.reason || ""} ${r.details || ""}`} searchPlaceholder="Search reports…"
        initialSort={{ key: "at", dir: "desc" }} resetKey={`${status}|${from}|${verdict}`} selectable onRowClick={onReview}
        filters={<>
          <select className="adm-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select>
          <select className="adm-select" value={verdict} onChange={(e) => setVerdict(e.target.value)} aria-label="AI verdict"><option value="">Any AI verdict</option><option value="flawed">Flawed</option><option value="repeated">Repeated</option><option value="fine">Fine</option><option value="unsure">Unsure</option><option value="none">Not checked</option></select>
          {players.length > 1 && <select className="adm-select" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Filed by"><option value="">Anyone</option>{players.map((p) => <option key={p} value={p}>{p}</option>)}</select>}
        </>}
        bulkActions={(sel, clear) => <>
          <button className="adm-btn ghost" disabled={!sel.some((r) => !r.resolvedAt)} onClick={() => { sel.filter((r) => !r.resolvedAt).forEach(onResolve); clear(); }}><CheckCheck size={15} /> Resolve</button>
          <button className="adm-btn ghost" onClick={() => downloadText(`word-hunter-reports-${sel.length}.json`, JSON.stringify({ kind: "word-hunter-reports", exportedAt: new Date().toISOString(), reports: sel.map(({ _key, _who, _verdict, ...r }) => r) }, null, 2), "application/json")}><FileJson size={15} /> Export JSON</button>
          <button className="adm-btn danger" onClick={() => setConfirm({ rows: sel, clear })}><Trash2 size={15} /> Delete</button>
        </>}
        emptyText="No reports. Players report questions from inside a round."
      />
      {confirm && <ConfirmDialog title={`Delete ${confirm.rows.length} report${confirm.rows.length === 1 ? "" : "s"}?`} danger confirmLabel="Delete"
        body={<p>Deleted reports stop blocking their question. Resolving keeps a record instead.</p>}
        onCancel={() => setConfirm(null)} onConfirm={() => { confirm.rows.forEach(onDelete); confirm.clear(); setConfirm(null); }} />}
    </div>
  );
}
