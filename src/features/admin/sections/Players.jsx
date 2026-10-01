import { useMemo, useState } from "react";
import { KeyRound, RotateCcw, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { V2 } from "../../../engine/v2";
import { isWordKey } from "../../../engine/data";
import { DataTable } from "../DataTable";
import { BarList, ChartCard, LineChart, SimpleTable, StackedBar, formatNumber, formatPercent } from "../charts";
import { Badge, ConfirmDialog, Drawer, Kpi, Notice, fmtDate, relTime, useAsync } from "../adminUi";

const acc = (p) => (p.answers_30d ? p.correct_30d / p.answers_30d : null);
const ACTIVITY = [{ id: "", label: "All players" }, { id: "active", label: "Active in 7 days" }, { id: "idle", label: "Idle 30+ days" }, { id: "new", label: "Joined in 7 days" }];

export function Players({ api, players, me, onChanged, openId, onOpen }) {
  const [role, setRole] = useState("");
  const [activity, setActivity] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind, rows }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const all = players.data || [];
  const now = Date.now();
  const rows = useMemo(() => all.filter((p) => (!role || p.role === role) && (
    !activity
    || (activity === "active" && p.last_active && now - Date.parse(p.last_active) < 7 * 86400000)
    || (activity === "idle" && (!p.last_active || now - Date.parse(p.last_active) > 30 * 86400000))
    || (activity === "new" && p.created_at && now - Date.parse(p.created_at) < 7 * 86400000))), [all, role, activity]);

  const columns = [
    { key: "username", label: "Player", render: (p) => <span className="adm-player"><i className="adm-avatar">{p.username.slice(0, 1).toUpperCase()}</i><b>{p.username}</b>{p.role === "admin" && <Badge tone="info">admin</Badge>}{p.id === me && <small>you</small>}</span> },
    { key: "score", label: "Score", num: true, defaultDir: "desc", render: (p) => formatNumber(p.score) },
    { key: "week_score", label: "This week", num: true, defaultDir: "desc", render: (p) => formatNumber(p.week_score) },
    { key: "mastered_count", label: "Mastered", num: true, defaultDir: "desc" },
    { key: "words_seen", label: "Words seen", num: true, defaultDir: "desc" },
    { key: "sessions_30d", label: "Sessions 30d", num: true, defaultDir: "desc" },
    { key: "accuracy", label: "Accuracy 30d", num: true, defaultDir: "desc", sortValue: acc, csv: (p) => (acc(p) == null ? "" : Math.round(acc(p) * 100)), render: (p) => (acc(p) == null ? "—" : formatPercent(acc(p))) },
    { key: "study_streak", label: "Streak", num: true, defaultDir: "desc", render: (p) => `${p.study_streak}d` },
    { key: "live", label: "Live W/P", num: true, defaultDir: "desc", sortValue: (p) => p.live_wins, csv: (p) => `${p.live_wins}/${p.live_played}`, render: (p) => `${p.live_wins}/${p.live_played}` },
    { key: "ai_today", label: "AI today", num: true, defaultDir: "desc" },
    { key: "last_active", label: "Last active", defaultDir: "desc", sortValue: (p) => (p.last_active ? Date.parse(p.last_active) : null), csv: (p) => p.last_active || "", render: (p) => <span title={fmtDate(p.last_active)}>{relTime(p.last_active)}</span> },
    { key: "created_at", label: "Joined", defaultDir: "desc", sortValue: (p) => (p.created_at ? Date.parse(p.created_at) : null), csv: (p) => p.created_at || "", render: (p) => relTime(p.created_at) },
  ];

  async function runBulk(kind, targets) {
    setBusy(true); setError(null);
    try {
      for (const p of targets) {
        if (kind === "reset") await api.resetPlayer(p.id);
        if (kind === "delete") await api.deletePlayer(p.id);
      }
      setConfirm(null); onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className={`adm-section ${players.loading ? "is-refreshing" : ""}`}>
      {(players.error || error) && <Notice tone="error">{players.error || error}</Notice>}
      {!api.online && <Notice>Player management needs the online version; this is your local profile only.</Notice>}
      <div className="adm-kpis compact">
        <Kpi label="Players" value={all.length} />
        <Kpi label="Active · 7 days" value={all.filter((p) => p.last_active && now - Date.parse(p.last_active) < 7 * 86400000).length} />
        <Kpi label="Joined · 7 days" value={all.filter((p) => p.created_at && now - Date.parse(p.created_at) < 7 * 86400000).length} />
        <Kpi label="Avg. mastered" value={all.length ? Math.round(all.reduce((a, p) => a + p.mastered_count, 0) / all.length) : 0} />
      </div>
      <DataTable
        id="players" columns={columns} rows={rows} rowKey={(p) => p.id} csvName="word-hunter-players"
        searchText={(p) => p.username} searchPlaceholder="Search players…" initialSort={{ key: "score", dir: "desc" }}
        resetKey={`${role}|${activity}`} onRowClick={(p) => onOpen(p.id)} selectable={api.online}
        filters={<>
          <select className="adm-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option><option value="admin">Admins</option><option value="player">Players</option></select>
          <select className="adm-select" value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Activity">{ACTIVITY.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
        </>}
        bulkActions={(sel, clear) => {
          const targets = sel.filter((p) => p.id !== me);
          return <>
            <button className="adm-btn ghost" disabled={!targets.length} onClick={() => setConfirm({ kind: "reset", rows: targets, clear })}><RotateCcw size={15} /> Reset progress</button>
            <button className="adm-btn danger" disabled={!targets.length} onClick={() => setConfirm({ kind: "delete", rows: targets, clear })}><Trash2 size={15} /> Delete</button>
          </>;
        }}
        emptyText="No players yet. Share the link — anyone can create an account."
      />
      {confirm && <ConfirmDialog
        title={confirm.kind === "delete" ? `Delete ${confirm.rows.length} player${confirm.rows.length === 1 ? "" : "s"}?` : `Reset progress for ${confirm.rows.length} player${confirm.rows.length === 1 ? "" : "s"}?`}
        body={<><p>{confirm.kind === "delete" ? "Their accounts, progress, reports and live results are removed for good." : "Their score, mastery and history go back to zero. Their accounts stay."}</p><p className="adm-muted">{confirm.rows.map((p) => p.username).join(", ")}</p></>}
        confirmLabel={confirm.kind === "delete" ? "Delete" : "Reset"} danger confirmText={confirm.kind === "delete" ? "DELETE" : undefined} busy={busy}
        onCancel={() => setConfirm(null)} onConfirm={async () => { await runBulk(confirm.kind, confirm.rows); confirm.clear(); }} />}
      {openId && <PlayerDrawer api={api} id={openId} me={me} onClose={() => onOpen(null)} onChanged={onChanged} />}
    </div>
  );
}

function PlayerDrawer({ api, id, me, onClose, onChanged }) {
  const detail = useAsync(() => api.playerDetail(id), [id]);
  const [confirm, setConfirm] = useState(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const d = detail.data;
  const p = d?.profile;
  const sessions = useMemo(() => [...(d?.sessions || [])].sort((a, b) => a.at - b.at), [d]);
  const stages = useMemo(() => {
    const c = { New: 0, Familiar: 0, Learned: 0, Mastered: 0 };
    for (const [k, s] of Object.entries(d?.mastery || {})) if (isWordKey(k)) c[V2.stage(s)]++;
    return c;
  }, [d]);
  const weakest = useMemo(() => Object.entries(d?.mastery || {}).filter(([k, s]) => isWordKey(k) && (s?.total || 0) >= 2)
    .map(([k, s]) => ({ key: k, label: k, value: 1 - (s.correct || 0) / s.total, sub: `${s.correct || 0}/${s.total} right` }))
    .sort((a, b) => b.value - a.value).slice(0, 8), [d]);
  const sessionData = sessions.slice(-30).map((s, i) => ({ key: `${s.id}-${i}`, label: new Date(s.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }), title: `${s.title} · ${fmtDate(s.at)}`, value: s.total ? s.correct / s.total : null }));
  const self = id === me;

  async function act(fn, done) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ tone: "ok", text: done }); onChanged(); detail.reload(); }
    catch (e) { setMsg({ tone: "error", text: e.message }); }
    setBusy(false); setConfirm(null);
  }

  return (
    <Drawer title={p?.username || "Player"} subtitle={p ? `${p.role === "admin" ? "Admin" : "Player"}${p.created_at ? ` · joined ${relTime(p.created_at)}` : ""}` : "Loading…"} onClose={onClose}>
      {detail.error && <Notice tone="error">{detail.error}</Notice>}
      {msg && <Notice tone={msg.tone === "ok" ? "success" : "error"}>{msg.text}</Notice>}
      {p && <>
        <div className="adm-kpis compact">
          <Kpi label="Score" value={p.score ?? 0} sub={`${formatNumber(p.week_score ?? 0)} this week`} />
          <Kpi label="Mastered" value={stages.Mastered} sub={`${Object.keys(d.mastery).length} words seen`} />
          <Kpi label="Study streak" value={`${p.study_streak ?? 0}d`} sub={`best ${p.best_study_streak ?? 0}d`} />
          <Kpi label="Live" value={`${p.live_wins ?? 0}/${p.live_played ?? 0}`} sub="wins / played" />
        </div>
        <ChartCard title="Accuracy per session" subtitle={`Last ${sessionData.length} sessions`}
          table={<SimpleTable columns={[{ key: "title", label: "Session" }, { key: "value", label: "Accuracy", num: true, format: (v) => (v == null ? "—" : formatPercent(v)) }]} rows={[...sessionData].reverse()} />}>
          <LineChart data={sessionData} valueLabel="accuracy" format={formatPercent} yMax={1} height={170} emptyText="No sessions yet." />
        </ChartCard>
        <ChartCard title="Learning stages" subtitle="Words this player has met">
          <StackedBar segments={[
            { label: "New", value: stages.New, cls: "ord-1" },
            { label: "Familiar", value: stages.Familiar, cls: "ord-2" },
            { label: "Learned", value: stages.Learned, cls: "ord-3" },
            { label: "Mastered", value: stages.Mastered, cls: "ord-4" },
          ]} />
        </ChartCard>
        <ChartCard title="Weakest words" subtitle="Most wrong answers (2+ tries)">
          <BarList data={weakest} format={formatPercent} valueLabel="wrong" max={1} emptyText="No weak words yet." />
        </ChartCard>
        <ChartCard title="Recent sessions">
          {sessions.length ? <SimpleTable columns={[{ key: "at", label: "When", format: (v) => fmtDate(v) }, { key: "title", label: "Session" }, { key: "kind", label: "Type" }, { key: "score", label: "Right", num: true }]} rows={[...sessions].reverse().slice(0, 15).map((s) => ({ ...s, score: `${s.correct}/${s.total}` }))} /> : <p className="adm-muted">No sessions yet.</p>}
        </ChartCard>
        {d.live?.length > 0 && <ChartCard title="Live matches">
          <SimpleTable columns={[{ key: "played_at", label: "When", format: (v) => fmtDate(v) }, { key: "title", label: "Lesson" }, { key: "rank", label: "Place", num: true, format: (v, r) => `${v} of ${r.players}` }, { key: "points", label: "Points", num: true }]} rows={d.live} />
        </ChartCard>}

        {api.online && <section className="adm-card adm-actions-card">
          <h3>Account</h3>
          <div className="adm-action-row">
            {p.role === "admin"
              ? <button className="adm-btn ghost" disabled={self || busy} title={self ? "You can't remove your own admin role" : ""} onClick={() => act(() => api.setRole(id, "player"), `${p.username} is now a player.`)}><ShieldOff size={15} /> Make player</button>
              : <button className="adm-btn ghost" disabled={busy} onClick={() => setConfirm("admin")}><ShieldCheck size={15} /> Make admin</button>}
          </div>
          <form className="adm-action-row" onSubmit={(e) => { e.preventDefault(); act(() => api.setPassword(id, pw), `Password changed for ${p.username}.`).then(() => setPw("")); }}>
            <input className="adm-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (6+ characters)" minLength={6} autoComplete="new-password" />
            <button className="adm-btn ghost" disabled={busy || pw.length < 6}><KeyRound size={15} /> Set password</button>
          </form>
          {!self && <div className="adm-action-row">
            <button className="adm-btn ghost" disabled={busy} onClick={() => setConfirm("reset")}><RotateCcw size={15} /> Reset progress</button>
            <button className="adm-btn danger" disabled={busy} onClick={() => setConfirm("delete")}><Trash2 size={15} /> Delete account</button>
          </div>}
        </section>}
      </>}
      {confirm && <ConfirmDialog
        title={confirm === "admin" ? `Make ${p.username} an admin?` : confirm === "reset" ? `Reset ${p.username}'s progress?` : `Delete ${p.username}?`}
        body={<p>{confirm === "admin" ? "Admins can edit all content, see every player and manage accounts." : confirm === "reset" ? "Score, mastery and history go back to zero. The account stays." : "The account, progress, reports and live results are removed for good."}</p>}
        confirmLabel={confirm === "admin" ? "Make admin" : confirm === "reset" ? "Reset" : "Delete"} danger={confirm !== "admin"} confirmText={confirm === "delete" ? p.username : undefined} busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm === "admin" ? act(() => api.setRole(id, "admin"), `${p.username} is now an admin.`)
          : confirm === "reset" ? act(() => api.resetPlayer(id), "Progress reset.")
          : act(() => api.deletePlayer(id), "Account deleted.").then(onClose))} />}
    </Drawer>
  );
}
