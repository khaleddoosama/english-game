// Admin -> Settings: rules for the whole app. Saved in one go; the server
// validates every value and enforces sign-ups, AI/voice limits and Live
// rules, and the change shows up in the Activity log.
import { useEffect, useMemo, useState } from "react";
import { Bot, Megaphone, Save, ShieldAlert, Swords, Trophy, UserPlus, Users } from "lucide-react";
import { APP_DEFAULTS, normalizeAppSettings, saveAppSettings, useAppSettings } from "../../../lib/appSettings";
import { Notice } from "../adminUi";

function Field({ label, hint, children }) {
  return <label className="adm-set-field"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><div>{children}</div></label>;
}
function Switch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`adm-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button>;
}
function Num({ value, min, max, onChange, label }) {
  return <input type="number" className="adm-input adm-num" aria-label={label} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
}

export function AppSettings({ onDirtyChange = () => {} }) {
  const saved = useAppSettings();
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  useEffect(() => { setDraft(saved); }, [saved]);
  const clean = useMemo(() => normalizeAppSettings(draft), [draft]);
  const dirty = JSON.stringify(clean) !== JSON.stringify(normalizeAppSettings(saved));
  useEffect(() => { onDirtyChange(dirty); }, [dirty]);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMessage(null); };
  const setNd = (patch) => set({ newPlayerDefaults: { ...draft.newPlayerDefaults, ...patch } });

  async function save() {
    setBusy(true); setMessage(null);
    try { await saveAppSettings(clean); setMessage({ tone: "info", text: "Saved. Players get the new settings the next time they open the game." }); }
    catch (e) { setMessage({ tone: "error", text: `Couldn't save: ${e.message}` }); }
    setBusy(false);
  }

  return (
    <div className="adm-section adm-settings">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="adm-set-grid">
        <section className="adm-card">
          <h3><UserPlus size={16} /> Access</h3>
          <Field label="New accounts" hint="Anyone can create an account from the sign-in page"><Switch label="New accounts" checked={draft.signupsOpen} onChange={(v) => set({ signupsOpen: v })} /></Field>
          <Field label="Maintenance mode" hint="Players see a message instead of the game; you can still play"><Switch label="Maintenance mode" checked={draft.maintenance} onChange={(v) => set({ maintenance: v })} /></Field>
          {draft.maintenance && <textarea className="adm-input adm-textarea" maxLength={500} value={draft.maintenanceMessage} onChange={(e) => set({ maintenanceMessage: e.target.value })} placeholder="We're updating the game. Back soon!" aria-label="Maintenance message" />}
        </section>

        <section className="adm-card">
          <h3><Megaphone size={16} /> Announcement</h3>
          <p className="adm-muted">Shown at the top of everyone's home screen until you clear it. Players can hide it for themselves.</p>
          <textarea className="adm-input adm-textarea" maxLength={500} value={draft.announcement} onChange={(e) => set({ announcement: e.target.value })} placeholder="e.g. New words for Unit 4 are in! Try a Live Challenge with your class tonight." aria-label="Announcement" />
          <Field label="Style"><select className="adm-select" value={draft.announcementTone} onChange={(e) => set({ announcementTone: e.target.value })}><option value="info">Neutral</option><option value="success">Good news</option><option value="warning">Important</option></select></Field>
          {clean.announcement && <div className={`adm-preview wh-announcement ${clean.announcementTone}`}><p>{clean.announcement}</p></div>}
        </section>

        <section className="adm-card">
          <h3><Bot size={16} /> AI and voice</h3>
          <Field label="AI for players" hint="Ask AI, AI answer checks and story writing"><Switch label="AI for players" checked={draft.aiForPlayers} onChange={(v) => set({ aiForPlayers: v })} /></Field>
          <Field label="AI pronunciation for players" hint="Off: phrases use the device's voice"><Switch label="AI pronunciation" checked={draft.ttsForPlayers} onChange={(v) => set({ ttsForPlayers: v })} /></Field>
          <Field label="AI calls per player per day" hint="Includes pronunciation. The admin has no limit."><Num label="AI calls per day" min={0} max={2000} value={draft.aiDailyLimit} onChange={(v) => set({ aiDailyLimit: v })} /></Field>
        </section>

        <section className="adm-card">
          <h3><Swords size={16} /> Live Challenge</h3>
          <Field label="Who can create challenges"><select className="adm-select" value={draft.liveCreate} onChange={(e) => set({ liveCreate: e.target.value })}><option value="everyone">Every player</option><option value="admin">Only the admin</option></select></Field>
          <Field label="Most players per challenge" hint="2 to 10"><Num label="Most players" min={2} max={10} value={draft.liveMaxPlayers} onChange={(v) => set({ liveMaxPlayers: v })} /></Field>
          <Field label="Default questions"><select className="adm-select" value={clean.liveDefaultQuestions} onChange={(e) => set({ liveDefaultQuestions: Number(e.target.value) })}>{[5, 10, 15, 20, 25, 30].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="Default time per question"><select className="adm-select" value={clean.liveDefaultSeconds} onChange={(e) => set({ liveDefaultSeconds: Number(e.target.value) })}>{[[0, "No limit"], [10, "10s"], [15, "15s"], [20, "20s"], [30, "30s"], [45, "45s"], [60, "60s"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Longest link lifetime" hint="Hours a player's link can stay open"><select className="adm-select" value={clean.liveMaxHours} onChange={(e) => set({ liveMaxHours: Number(e.target.value) })}>{[[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [72, "3 days"], [168, "7 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </section>

        <section className="adm-card">
          <h3><Trophy size={16} /> Leaderboard</h3>
          <Field label="Show the leaderboard to players" hint="Hides the Ranks tab; you still see it"><Switch label="Leaderboard" checked={draft.leaderboard} onChange={(v) => set({ leaderboard: v })} /></Field>
        </section>

        <section className="adm-card">
          <h3><Users size={16} /> New players start with</h3>
          <p className="adm-muted">Players can change these on their Settings page.</p>
          <Field label="Questions per round"><Num label="Questions per round" min={4} max={30} value={draft.newPlayerDefaults.questionsPerRound} onChange={(v) => setNd({ questionsPerRound: v })} /></Field>
          <Field label="New words per round"><Num label="New words per round" min={0} max={10} value={draft.newPlayerDefaults.newWordsPerRound} onChange={(v) => setNd({ newWordsPerRound: v })} /></Field>
          <Field label="Daily goal"><Num label="Daily goal" min={5} max={100} value={draft.newPlayerDefaults.dailyGoal} onChange={(v) => setNd({ dailyGoal: v })} /></Field>
          <Field label="Sound effects"><Switch label="Sound effects" checked={draft.newPlayerDefaults.sound} onChange={(v) => setNd({ sound: v })} /></Field>
          <Field label="“Pick two” questions"><Switch label="Pick two questions" checked={draft.newPlayerDefaults.enablePairModes} onChange={(v) => setNd({ enablePairModes: v })} /></Field>
        </section>
      </div>
      {draft.maintenance && <Notice tone="error"><ShieldAlert size={14} /> Maintenance mode is on: players can't play until you turn it off.</Notice>}
      <div className={`adm-savebar ${dirty ? "dirty" : ""}`}>
        <span>{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        <button className="adm-btn ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>Discard</button>
        <button className="adm-btn ghost" disabled={busy} onClick={() => setDraft(normalizeAppSettings(APP_DEFAULTS))}>Defaults</button>
        <button className="adm-btn primary" disabled={!dirty || busy} onClick={save}><Save size={15} /> {busy ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}
