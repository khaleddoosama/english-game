import { useEffect, useState, useSyncExternalStore } from "react";
import { cancelAiOperation, dismissAiOperation, getAiOperations, subscribeAiOperations } from "../../lib/aiOperations.js";
import "../../styles/ai.css";

export function AiProgress() {
  const jobs = useSyncExternalStore(subscribeAiOperations, getAiOperations, getAiOperations);
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now());
  const running = jobs.filter(job => job.status === "running").length;
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [running]);
  if (!jobs.length) return null;
  return <aside className="wh-ai-progress" data-open={open} aria-label="AI progress">
    <button className="wh-ai-progress-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>AI progress{running ? ` · ${running} running` : ""} · {open ? "Hide" : "Show"}</button>
    {open && <div className="wh-ai-progress-list">{jobs.map(job => <div key={job.id} className="wh-ai-progress-job" aria-busy={job.status === "running"}>
      <b>{job.label}</b>
      {job.status === "running" ? <>
        <p role="status">{job.phase}{job.total > 0 ? ` · ${job.done || 0}/${job.total}` : ""} · {Math.max(0, Math.floor((now - job.startedAt) / 1000))}s{job.background ? " · in background" : ""}</p>
        {job.total > 0 ? <progress aria-label={job.label} value={job.done || 0} max={job.total}/> : <progress aria-label={job.label}/>}
        <button onClick={() => cancelAiOperation(job.id)}>Cancel</button>
      </> : <><p role={job.status === "failed" ? "alert" : "status"}>{job.error || job.phase}{job.warning ? ` · ${job.warning}` : ""}</p><button onClick={() => dismissAiOperation(job.id)}>Dismiss</button></>}
    </div>)}</div>}
  </aside>;
}
