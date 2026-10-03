// Import & export: the /data page in the game, and Admin -> Data & backup.
// Export a full backup (everyone), content only or a words spreadsheet
// (admin). Import in three steps: choose a file (drop, pick or paste),
// check it (what would change), apply it. Players can restore their own
// progress; only the admin imports game content.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ClipboardCopy, Download, FileJson, FileSpreadsheet, FileUp, Sparkles, Trash2, Upload, X } from "lucide-react";
import { importModes } from "./transfer";
import "../../styles/data.css";

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

function modeText(id, isBackup, isAdmin) {
  if (id === "content") return isBackup ? ["Content only", "Update the game content from this backup. Everyone's progress stays."] : ["Import the content", "New items are added and matching ones updated. Everyone's progress stays."];
  if (id === "full") return ["Content and my progress", "Replace the content and your own progress with the backup's."];
  return isAdmin ? ["My progress only", "Bring back your progress; leave the content as it is."] : ["Restore my progress", "Your score, streaks and word progress come back from this file. Game content comes from the admin and isn't changed."];
}

function save(file) {
  const blob = new Blob([file.text], { type: file.type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportExport({ variant = "game", isAdmin, tools, onBack }) {
  const light = variant === "admin";
  const c = tools.contentCounts, p = tools.progressCounts;
  return (
    <div className={`ie ${light ? "light" : ""}`}>
      {!light && <header className="ie-head">
        <button className="wh-back-btn" onClick={onBack}><ArrowLeft size={14} /> Back</button>
        <h2>Import &amp; export</h2>
        <p>Your progress saves to your account by itself. A backup file is an extra copy you keep, or a way to bring progress from another version.</p>
      </header>}
      <div className="ie-strip">
        <div><small>Your progress</small><b>{p.score.toLocaleString()} pts</b><span>{p.words} words practised · {p.mastered} mastered · {p.sessions} rounds</span></div>
        <div><small>Game content</small><b>{c.words.toLocaleString()} words</b><span>{c.grammar} grammar · {c.stories} stories · {c.challenges} challenges · {c.categories} categories</span></div>
      </div>
      <div className="ie-grid">
        <ExportCard isAdmin={isAdmin} tools={tools} />
        <ImportCard isAdmin={isAdmin} tools={tools} onDone={onBack} light={light} />
      </div>
      <section className="ie-card ie-danger">
        <h3><AlertTriangle size={16} /> Start over</h3>
        <div className="ie-danger-row">
          <div><b>Reset my progress</b><span>Clears your score, streaks and word progress. Game content stays.</span></div>
          <button className="ie-btn danger-ghost" onClick={tools.onResetProgress}><Trash2 size={15} /> Reset progress</button>
        </div>
        {isAdmin && light && <div className="ie-danger-row">
          <div><b>Delete all game content</b><span>Removes every word, grammar rule, story and challenge for everyone, and your progress. Download a full backup first.</span></div>
          <button className="ie-btn danger" onClick={tools.onWipeEverything}><Trash2 size={15} /> Delete everything</button>
        </div>}
      </section>
    </div>
  );
}

function ExportCard({ isAdmin, tools }) {
  const options = [
    { id: "backup", icon: FileJson, title: "Full backup", text: "Your progress and the game content in one file. Keep it safe, or use it to restore later." },
    { id: "wordsCsv", icon: FileSpreadsheet, title: "Word bank CSV", text: "Your course words and meanings for a spreadsheet." },
    ...(isAdmin ? [
      { id: "content", icon: FileJson, title: "Content only", text: "Words, grammar, stories and challenges, without anyone's progress. Good for an AI or a colleague to review and send back." },
    ] : []),
  ];
  const [kind, setKind] = useState("backup");
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState(null);
  useEffect(() => { const t = setTimeout(() => { try { setSize(new Blob([tools.exportFile(kind).text]).size); } catch { setSize(null); } }, 50); return () => clearTimeout(t); }, [kind]);
  async function copy() {
    try { await navigator.clipboard.writeText(tools.exportFile(kind).text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); window.alert("Couldn't copy. Use Download instead."); }
  }
  return (
    <section className="ie-card">
      <h3><Download size={16} /> Export</h3>
      <div className="ie-options" role="radiogroup" aria-label="What to export">
        {options.map(({ id, icon: Icon, title, text }) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} className={`ie-option ${kind === id ? "on" : ""}`} onClick={() => setKind(id)}>
            <Icon size={18} /><span><b>{title}</b><small>{text}</small></span>{kind === id && <Check size={16} className="ie-tick" />}
          </button>
        ))}
      </div>
      <div className="ie-actions">
        <button className="ie-btn primary" onClick={() => save(tools.exportFile(kind))}><Download size={15} /> Download{size ? ` · ${kb(size)}` : ""}</button>
        {kind !== "wordsCsv" && <button className="ie-btn" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><ClipboardCopy size={15} /> Copy</>}</button>}
      </div>
    </section>
  );
}

function Steps({ step }) {
  return <ol className="ie-steps">{["Choose a file", "Check it", "Apply"].map((label, i) => <li key={label} className={step > i + 1 ? "done" : step === i + 1 ? "on" : ""}><i>{step > i + 1 ? <Check size={12} /> : i + 1}</i>{label}</li>)}</ol>;
}

function ImportCard({ isAdmin, tools, onDone }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null); // { name, size }
  const [pasting, setPasting] = useState(false);
  const [drag, setDrag] = useState(false);
  const [check, setCheck] = useState(null);
  const [problem, setProblem] = useState(null); // { message, issues }
  const [fixing, setFixing] = useState(false);
  const [aiChanges, setAiChanges] = useState(null);
  const [mode, setMode] = useState(null);
  const [done, setDone] = useState(null);
  const inputRef = useRef(null);
  const step = done ? 4 : check ? 2 : 1;

  function reset() { setText(""); setFile(null); setCheck(null); setProblem(null); setAiChanges(null); setMode(null); setDone(null); setPasting(false); }
  function runCheck(t = text) {
    setProblem(null); setCheck(null);
    try {
      const result = tools.checkImport(t);
      setCheck(result);
      setMode(importModes(result, isAdmin)[0] || null);
    } catch (e) { setProblem({ message: e.message, issues: e.issues || [] }); }
  }
  function readFile(f) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { setProblem({ message: "This file is too big (over 25 MB).", issues: [] }); return; }
    const r = new FileReader();
    r.onload = () => { const t = String(r.result || ""); setText(t); setFile({ name: f.name, size: f.size }); setAiChanges(null); runCheck(t); };
    r.onerror = () => setProblem({ message: "Couldn't read that file. Try pasting its text instead.", issues: [] });
    r.readAsText(f);
  }
  async function aiFix() {
    setFixing(true);
    try {
      const fixed = await tools.aiFixImport(text, problem.issues.length ? problem.issues : [problem.message]);
      setText(fixed.text); setAiChanges(fixed.changes); setFile((x) => (x ? { ...x, name: `${x.name} (fixed by AI)` } : x));
      runCheck(fixed.text);
    } catch (e) { setProblem((pr) => ({ ...pr, aiError: e.message || "AI couldn't fix it." })); }
    setFixing(false);
  }
  function apply() {
    try { setDone(tools.applyImport(check, mode)); } catch (e) { setProblem({ message: e.message, issues: [] }); }
  }

  const contentOnlyForPlayer = check && !check.isBackup && !isAdmin;
  const replaces = mode === "full" || mode === "progress";
  const modes = check ? importModes(check, isAdmin).map((id) => [id, ...modeText(id, check.isBackup, isAdmin)]) : [];

  return (
    <section className="ie-card">
      <h3><Upload size={16} /> Import</h3>
      <Steps step={step} />
      {done ? (
        <div className="ie-done">
          <CheckCircle2 size={36} />
          <b>{done}</b>
          <div className="ie-actions"><button className="ie-btn primary" onClick={onDone}>Back to the game</button><button className="ie-btn" onClick={reset}>Import another file</button></div>
        </div>
      ) : !check ? <>
        <div className={`ie-drop ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}>
          <FileUp size={26} />
          {file ? <b>{file.name} <small>{kb(file.size)}</small></b> : <b>Drop a backup or content file here</b>}
          <span>.json or .txt</span>
          <input ref={inputRef} id="ie-file" type="file" accept=".json,.txt,application/json,text/plain" className="ie-hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; readFile(f); }} />
          <div className="ie-actions"><label htmlFor="ie-file" className="ie-btn primary">Choose a file</label><button className="ie-btn" onClick={() => setPasting((v) => !v)}>{pasting ? "Hide the text box" : "Paste text instead"}</button></div>
        </div>
        {pasting && <>
          <textarea className="ie-text" rows={8} value={text} onChange={(e) => { setText(e.target.value); setFile(null); setProblem(null); }} placeholder="Paste the JSON here…" aria-label="Pasted file" />
          <div className="ie-actions"><button className="ie-btn primary" disabled={!text.trim()} onClick={() => runCheck()}>Check</button></div>
        </>}
        {aiChanges && <div className="ie-note"><b><Sparkles size={14} /> AI changed:</b><ul>{aiChanges.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        {problem && <div className="ie-problem" role="alert">
          <b><AlertTriangle size={15} /> {problem.message}</b>
          {problem.issues.length > 0 && <ul>{problem.issues.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}{problem.issues.length > 12 && <li>…and {problem.issues.length - 12} more</li>}</ul>}
          {problem.aiError && <p>{problem.aiError}</p>}
          {isAdmin && text.trim() && <button className="ie-btn" disabled={fixing} onClick={aiFix}><Sparkles size={15} /> {fixing ? "AI is fixing it…" : "Fix with AI"}</button>}
        </div>}
      </> : <>
        <div className="ie-found">
          <span className={`ie-tag ${check.isBackup ? "backup" : ""}`}>{check.isBackup ? "Full backup" : "Content file"}{check.v3 ? " · v3" : ""}</span>
          {file && <span className="ie-file">{file.name}</span>}
          {check.exportedAt && <span className="ie-muted">made {when(check.exportedAt)}{check.exportedBy ? ` by ${check.exportedBy}` : ""}</span>}
          <button className="ie-icon" aria-label="Choose another file" title="Choose another file" onClick={reset}><X size={16} /></button>
        </div>
        {contentOnlyForPlayer ? <div className="ie-problem"><b>This file only has game content.</b><p>Only the admin can import content. To restore your progress, use a full backup.</p></div> : <>
          <table className="ie-table">
            <thead><tr><th>In the file</th><th className="num">New</th><th className="num">Changed</th><th className="num">Same</th></tr></thead>
            <tbody>
              {[["Words", check.words], ["Grammar rules", check.grammar], ["Challenges", check.challenges]].map(([label, d]) => <tr key={label}><td>{label}</td><td className="num">{d.added || "—"}</td><td className="num">{d.updated || "—"}</td><td className="num">{d.unchanged || "—"}</td></tr>)}
              <tr><td>Stories / combos</td><td className="num" colSpan={3}>{check.stories} / {check.combos}</td></tr>
            </tbody>
          </table>
          {check.progress && <p className="ie-progress">Progress in the file: <b>{check.progress.score.toLocaleString()} pts</b>, {check.progress.words} words practised, {check.progress.mastered} mastered, {check.progress.sessions} rounds.</p>}
          {(check.renames.words.length > 0 || check.renames.categories.length > 0) && <details className="ie-details"><summary>{check.renames.words.length + check.renames.categories.length} renamed (progress moves with them)</summary><ul>{[...check.renames.words, ...check.renames.categories].map((r, i) => <li key={i}>{r.from} → {r.to}</li>)}</ul></details>}
          {check.warnings.length > 0 && <details className="ie-details warn"><summary>{check.warnings.length} warning{check.warnings.length === 1 ? "" : "s"} (the rest imports normally)</summary><ul>{check.warnings.slice(0, 40).map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {!isAdmin && check.isBackup && <p className="ie-muted">Content changes in this file are ignored: the game's words come from the admin.</p>}
          <div className="ie-modes" role="radiogroup" aria-label="What to import">
            {modes.map(([id, title, text]) => <button key={id} type="button" role="radio" aria-checked={mode === id} className={`ie-option ${mode === id ? "on" : ""}`} onClick={() => setMode(id)}><span><b>{title}</b><small>{text}</small></span>{mode === id && <Check size={16} className="ie-tick" />}</button>)}
          </div>
          {replaces && <div className="ie-note warn"><AlertTriangle size={15} /> This replaces your current progress ({tools.progressCounts.score.toLocaleString()} pts, {tools.progressCounts.words} words). <button className="ie-link" onClick={() => save(tools.exportFile("backup"))}>Download a backup of it first</button></div>}
          {problem && <div className="ie-problem" role="alert"><b>{problem.message}</b></div>}
          <div className="ie-actions">
            <button className="ie-btn primary ie-apply" disabled={!mode} onClick={apply}>{mode === "content" ? "Import content" : mode === "full" ? "Restore content and progress" : "Restore my progress"}</button>
            <button className="ie-btn" onClick={reset}>Cancel</button>
          </div>
        </>}
      </>}
    </section>
  );
}
