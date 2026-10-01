// Player settings (/settings): how rounds are built, how playing feels,
// how the game looks, and defaults for challenges. Every change applies at
// once and is saved with the player's progress.
import { ArrowLeft, Database, Gauge, Monitor, RotateCcw, SlidersHorizontal, Swords, Volume2 } from "lucide-react";
import { AUTO_ADVANCE_OPTIONS, DEFAULT_SETTINGS, SPEED_SECONDS_OPTIONS, normalizeSettings } from "../../engine/progress";

function Row({ label, hint, children }) {
  return <div className="st-row"><div className="st-label"><b>{label}</b>{hint && <small>{hint}</small>}</div><div className="st-control">{children}</div></div>;
}
function Toggle({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`st-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button>;
}
function Choice({ value, options, onChange, label }) {
  return <div className="st-seg" role="radiogroup" aria-label={label}>{options.map(([v, text]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>)}</div>;
}
function Stepper({ value, min, max, step = 1, onChange, label, unit }) {
  return (
    <div className="st-stepper" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <output>{value}{unit ? <small> {unit}</small> : null}</output>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

export default function SettingsPage({ settings, onChange, onBack, onOpen, app }) {
  const set = (patch) => onChange(normalizeSettings({ ...settings, ...patch }));
  const voices = typeof window !== "undefined" && "speechSynthesis" in window;
  return (
    <div className="ui-page st-page">
      <header className="st-head">
        <button className="wh-back-btn" onClick={onBack}><ArrowLeft size={14} /> Back</button>
        <h2><SlidersHorizontal size={20} /> Settings</h2>
        <p>Changes apply right away and are saved to your account.</p>
      </header>

      <section className="st-card">
        <h3><Gauge size={16} /> Rounds</h3>
        <Row label="Questions per round" hint="Level practice"><Stepper label="questions" value={settings.questionsPerRound} min={4} max={30} onChange={(v) => set({ questionsPerRound: v })} /></Row>
        <Row label="New words per round" hint="0 = review only"><Stepper label="new words" value={settings.newWordsPerRound} min={0} max={10} onChange={(v) => set({ newWordsPerRound: v })} /></Row>
        <Row label="Weak-word review size" hint="Questions in a weak-words round"><Stepper label="review questions" value={settings.weakReviewSize} min={3} max={20} onChange={(v) => set({ weakReviewSize: v })} /></Row>
        <Row label="Daily goal" hint="Questions per day"><Stepper label="daily goal" value={settings.dailyGoal} min={5} max={100} step={5} onChange={(v) => set({ dailyGoal: v })} /></Row>
        <Row label="“Pick two” questions" hint="Two People and Select Two"><Toggle label="Pick two questions" checked={settings.enablePairModes} onChange={(v) => set({ enablePairModes: v })} /></Row>
      </section>

      <section className="st-card">
        <h3><Volume2 size={16} /> Playing</h3>
        <Row label="Next question after a right answer" hint="Wrong answers always wait for you"><Choice label="Auto-advance" value={settings.autoAdvanceMs} onChange={(v) => set({ autoAdvanceMs: v })} options={AUTO_ADVANCE_OPTIONS.map((ms) => [ms, ms ? `${ms / 1000}s` : "Tap Continue"])} /></Row>
        <Row label="Hints" hint="Show the Hint button"><Toggle label="Hints" checked={settings.hints} onChange={(v) => set({ hints: v })} /></Row>
        <Row label="Sound effects" hint="For right and wrong answers"><Toggle label="Sound effects" checked={settings.sound} onChange={(v) => set({ sound: v })} /></Row>
        <Row label="Say the word after answering" hint={voices ? "Uses your device's voice" : "Your browser has no voice"}><Toggle label="Say the word" checked={settings.speakWord && voices} onChange={(v) => set({ speakWord: v })} /></Row>
        <Row label="Speed Round length"><Choice label="Speed Round length" value={settings.speedSeconds} onChange={(v) => set({ speedSeconds: v })} options={SPEED_SECONDS_OPTIONS.map((s) => [s, s < 60 ? `${s}s` : `${s / 60} min`])} /></Row>
      </section>

      <section className="st-card">
        <h3><Monitor size={16} /> Display</h3>
        <Row label="Text size"><Choice label="Text size" value={settings.textSize} onChange={(v) => set({ textSize: v })} options={[["normal", "Normal"], ["large", "Large"], ["xlarge", "Extra large"]]} /></Row>
        <Row label="Number keys on answers" hint="Shows 1–4 to answer with the keyboard"><Toggle label="Number keys" checked={settings.shortcuts} onChange={(v) => set({ shortcuts: v })} /></Row>
        <Row label="Reduce motion" hint="Fewer animations"><Toggle label="Reduce motion" checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} /></Row>
        <Row label="Home shows lessons"><Choice label="Home layout" value={settings.levelView} onChange={(v) => set({ levelView: v })} options={[["lesson", "By lesson"], ["group", "By unit"]]} /></Row>
      </section>

      <section className="st-card">
        <h3><Swords size={16} /> Live Challenge</h3>
        <p className="st-note">Starting values when you create a challenge.{app?.liveCreate === "admin" ? " Creating challenges is limited to the admin right now." : ""}</p>
        <Row label="Questions"><Choice label="Challenge questions" value={settings.liveQuestions ?? app?.liveDefaultQuestions ?? 10} onChange={(v) => set({ liveQuestions: v })} options={[5, 10, 15, 20, 25, 30].map((n) => [n, String(n)])} /></Row>
        <Row label="Time per question"><Choice label="Challenge time" value={settings.liveSeconds ?? app?.liveDefaultSeconds ?? 20} onChange={(v) => set({ liveSeconds: v })} options={[[0, "No limit"], [10, "10s"], [15, "15s"], [20, "20s"], [30, "30s"], [45, "45s"], [60, "60s"]]} /></Row>
      </section>

      <section className="st-card">
        <h3><Database size={16} /> Your data</h3>
        <div className="st-links">
          <button className="st-link" onClick={() => onOpen("data")}>Import &amp; export</button>
          <button className="st-link" onClick={() => onOpen("stats")}>Study dashboard</button>
          <button className="st-link" onClick={() => onOpen("profile")}>Profile &amp; password</button>
        </div>
      </section>

      <button className="st-reset" onClick={() => onChange(normalizeSettings({ ...DEFAULT_SETTINGS, ...(app?.newPlayerDefaults || {}) }))}><RotateCcw size={14} /> Reset to defaults</button>
    </div>
  );
}
