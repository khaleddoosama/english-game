import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Clock, Copy, Crown, Link2, LogOut, Play as PlayIcon, Plus, Share2, Timer, Trophy, UserMinus, Users, X } from "lucide-react";
import { WordPicture } from "../media/media";
import { levelGroups } from "../../engine/data";
import { LIVE_KINDS, liveOption, liveQuestions } from "./liveEngine";
import { FEEDBACK_MS, MAX_PLAYERS, MIN_PLAYERS, challengeLink, codeFromInput, formatMs, standings } from "./liveRules";
import { getLiveApi, withRetry } from "./liveApi";
import { openLiveChannel } from "./transport";
import "../../styles/live.css";

// Live Challenge: the creator picks the words and the rules, gets a link
// (/live/CODE) and sends it to one friend or a whole group (2-10 players).
// Everyone answers the same questions at their own pace; the server checks
// each answer. Most right answers wins; a tie goes to the fastest total time.

const COUNTS = [5, 10, 15, 20, 25, 30];
const SECONDS = [[0, "No limit"], [10, "10s"], [15, "15s"], [20, "20s"], [30, "30s"], [45, "45s"], [60, "60s"]];
const HOURS = [[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [72, "3 days"], [168, "7 days"]];

function preloadPictures(questions) {
  if (typeof Image === "undefined") return;
  for (const q of questions || []) {
    const src = typeof q.photo === "string" ? q.photo : null;
    if (src && /^https?:/.test(src)) { const img = new Image(); img.decoding = "async"; img.referrerPolicy = "no-referrer"; img.src = src; }
  }
}
const timeLeft = (iso) => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "ended";
  const mins = Math.ceil(ms / 60000), h = Math.floor(mins / 60), m = mins % 60;
  return h >= 24 ? `${Math.round(h / 24)}d left` : h ? `${h}h${m ? ` ${m}m` : ""} left` : `${m}m left`;
};
const rulesText = (v) => [
  `${v.question_count} questions`,
  v.seconds ? `${v.seconds}s each` : "no time limit",
  `up to ${v.max_players} players`,
  v.start_mode === "anytime" ? "start anytime" : "start together",
];

export function LiveChallenge({ player, levels, code, onOpenCode, onExit, pools = null, getSeen = () => ({}), onSeen = () => {}, onRefresh = () => {}, limits = {} }) {
  const api = useMemo(() => getLiveApi(() => player), [player]);
  return (
    <div className="lv">
      {code
        ? <ChallengeRoom key={code} api={api} code={code} player={player} onHome={() => onOpenCode(null)} onSeen={onSeen} />
        : <LiveHome api={api} player={player} levels={levels} pools={pools} getSeen={getSeen} onRefresh={onRefresh} onOpenCode={onOpenCode} onExit={onExit} limits={limits} />}
    </div>
  );
}

/* ------------------------------------------------------------------ home */

function LiveHome({ api, player, levels, pools, getSeen, onRefresh, onOpenCode, onExit, limits }) {
  const [creating, setCreating] = useState(false);
  const [joinText, setJoinText] = useState("");
  const [joinError, setJoinError] = useState(null);
  const [mine, setMine] = useState(null);
  useEffect(() => { api.mine().then(setMine).catch(() => setMine([])); }, [api]);
  const join = () => {
    const c = codeFromInput(joinText);
    if (!c) { setJoinError("Paste the challenge link, or type its 6-character code."); return; }
    onOpenCode(c);
  };
  if (creating) return <CreateForm api={api} levels={levels} pools={pools} getSeen={getSeen} onRefresh={onRefresh} onCancel={() => setCreating(false)} onCreated={onOpenCode} limits={limits} />;
  const open = (mine || []).filter((c) => c.state !== "done");
  const past = (mine || []).filter((c) => c.state === "done");
  return (
    <>
      <header className="lv-hero">
        <div>
          <h2><Users size={20} /> Live Challenge</h2>
          <p>Send a link to a friend or a group of up to {limits.maxPlayers || MAX_PLAYERS}. Everyone gets the same questions and plays at their own pace. Most right answers wins; a tie goes to the fastest.</p>
        </div>
        <button className="wh-back-btn" onClick={onExit}>Back</button>
      </header>
      <div className="lv-actions">
        <section className="lv-tile primary">
          <h3><Plus size={16} /> New challenge</h3>
          <p>Choose the words, the number of questions, the time per question and how many can join.</p>
          {limits.canCreate === false
            ? <p className="lv-note">Creating challenges is turned off right now. You can still join one.</p>
            : <button className="lv-btn gold" disabled={!levels.length} onClick={() => setCreating(true)}>Create a challenge</button>}
          {!levels.length && <p className="lv-note">There are no words yet to build a challenge from.</p>}
        </section>
        <section className="lv-tile">
          <h3><Link2 size={16} /> Got a link?</h3>
          <p>Open it, or paste it here (the 6-character code works too).</p>
          <div className="lv-join">
            <input value={joinText} onChange={(e) => { setJoinText(e.target.value); setJoinError(null); }} onKeyDown={(e) => { if (e.key === "Enter") join(); }} placeholder="Link or code" aria-label="Challenge link or code" autoCapitalize="characters" spellCheck={false} />
            <button className="lv-btn" onClick={join} disabled={!joinText.trim()}>Join</button>
          </div>
          {joinError && <p className="lv-error">{joinError}</p>}
        </section>
      </div>
      <section className="lv-list">
        <h3>Your challenges</h3>
        {mine === null ? <div className="ui-skeleton-row" /> : !mine.length ? <p className="lv-note">Challenges you create or join show up here for two weeks.</p> : (
          <ul>
            {[...open, ...past].map((c) => (
              <li key={c.code}>
                <button onClick={() => onOpenCode(c.code)}>
                  <span className="lv-list-main"><b>{c.title}</b><small>{c.code} · {c.players}/{c.max_players} players · {c.question_count} questions{c.host ? " · you created it" : ""}</small></span>
                  <span className={`lv-state ${c.state}`}>{c.state === "done" ? (c.rank ? (c.rank === 1 ? "🏆 Won" : `#${c.rank}`) : "Ended") : c.state === "lobby" ? "Waiting" : c.finished ? "Finished" : "Playing"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="lv-you">Playing as <b>{player.name}</b></p>
    </>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="lv-field">
      <span>{label}</span>
      <div className="lv-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </div>
  );
}

function CreateForm({ api, levels, pools, getSeen, onRefresh, onCancel, onCreated, limits }) {
  const cap = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, limits.maxPlayers || MAX_PLAYERS));
  const [lesson, setLesson] = useState("all");
  const [unit, setUnit] = useState("");
  const [count, setCount] = useState(limits.defaultCount || 10);
  const [seconds, setSeconds] = useState(limits.defaultSeconds ?? 20);
  const [maxPlayers, setMaxPlayers] = useState(cap);
  const [startMode, setStartMode] = useState("together");
  const [hours, setHours] = useState(24);
  const [kinds, setKinds] = useState(LIVE_KINDS.map((k) => k.id));
  const [reveal, setReveal] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const level = lesson === "all" ? null : levels[Number(lesson)];
  const groups = level ? levelGroups(level).filter((g) => g.id) : [];
  const words = useMemo(() => {
    const src = level ? [level] : levels;
    return src.flatMap((l) => l.items.filter((it) => it.kind === "word").map((it) => it.obj))
      .filter((w) => !unit || (groups[0]?.field === "unit" ? (w.units || []).includes(unit) : w.subCategory === unit));
  }, [levels, level, unit]);
  const autoTitle = level ? `${level.title}${unit ? ` · ${groups.find((g) => g.id === unit)?.title || unit}` : ""}` : "Mixed lessons";

  async function create() {
    setError(null);
    if (!kinds.length) { setError("Pick at least one question type."); return; }
    const questions = liveQuestions(words, count, { pools, seen: getSeen(), kinds });
    if (questions.length < 3) { setError("Not enough words with safe multiple-choice questions here. Pick more lessons or more question types."); return; }
    setBusy(true);
    try {
      const code = await api.create({
        title: title.trim() || autoTitle, seconds, maxPlayers, startMode, hours, questions,
        settings: { lesson: level?.title || null, unit: unit || null, kinds, reveal, requested: count },
      });
      onRefresh(words);
      onCreated(code);
    } catch (e) { setError(`Couldn't create the challenge: ${e.message}`); setBusy(false); }
  }

  return (
    <section className="wh-card lv-form">
      <div className="lv-form-head"><h2>New challenge</h2><button className="lv-icon" onClick={onCancel} aria-label="Cancel"><X size={18} /></button></div>
      <div className="lv-grid">
        <label className="lv-field"><span>Words from</span>
          <select value={lesson} onChange={(e) => { setLesson(e.target.value); setUnit(""); }}>
            <option value="all">All lessons (mixed)</option>
            {levels.map((l, i) => <option key={l.title} value={i}>{l.title}</option>)}
          </select>
        </label>
        {groups.length > 1 && <label className="lv-field"><span>{groups[0].field === "unit" ? "Unit" : "Group"}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">All</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        </label>}
      </div>
      <Segmented label="Questions" value={count} onChange={setCount} options={COUNTS.map((n) => [n, String(n)])} />
      <Segmented label="Time per question" value={seconds} onChange={setSeconds} options={SECONDS} />
      <div className="lv-field">
        <span>Players <b className="lv-val">up to {maxPlayers}</b></span>
        <input type="range" min={MIN_PLAYERS} max={cap} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} aria-label="Maximum players" />
        <small className="lv-hint">2 for a duel, more for a group. The challenge closes when it's full.</small>
      </div>
      <Segmented label="Start" value={startMode} onChange={setStartMode} options={[["together", "Together, when I press Start"], ["anytime", "Anytime, as each player opens it"]]} />
      <Segmented label="The link works for" value={hours} onChange={setHours} options={HOURS} />
      <div className="lv-field">
        <span>Question types</span>
        <div className="lv-chips">
          {LIVE_KINDS.map((k) => {
            const on = kinds.includes(k.id);
            return <button key={k.id} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => setKinds((list) => (on ? list.filter((x) => x !== k.id) : [...list, k.id]))}>{on && <Check size={13} />}{k.label}</button>;
          })}
        </div>
      </div>
      <label className="lv-toggle"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /><span>Show the right answer after each question</span></label>
      <label className="lv-field"><span>Name (optional)</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} /></label>
      <p className="lv-summary">{words.length} words to pick from · {count} questions · {seconds ? `${seconds}s each` : "no time limit"} · up to {maxPlayers} players</p>
      {error && <p className="lv-error">{error}</p>}
      <div className="lv-row">
        <button className="lv-btn gold" disabled={busy || !words.length} onClick={create}>{busy ? "Creating…" : "Create and get the link"}</button>
        <button className="lv-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ challenge */

function ChallengeRoom({ api, code, player, onHome, onSeen }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState([]);
  const [channelState, setChannelState] = useState("connecting");
  const [localMe, setLocalMe] = useState(null); // newest of my own rows, from answer results
  const channelRef = useRef(null), viewRef = useRef(null);
  const keep = (v) => { viewRef.current = v; setView(v); };

  const refresh = useCallback(async () => {
    try { keep(await api.view(code)); setLoadError(null); }
    catch (e) { if (!viewRef.current) setLoadError(e.message); }
  }, [api, code]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (view?.questions) preloadPictures(view.questions); }, [view?.questions]);

  // Realtime while I'm in it; polling covers a missing channel.
  const member = !!view?.member;
  useEffect(() => {
    if (!member) return;
    const ch = openLiveChannel(code, { id: player.id, name: player.name }, {
      onEvent(event, payload) {
        if (event === "progress" && payload?.user_id) {
          const cur = viewRef.current;
          if (cur) keep({ ...cur, players: cur.players.map((p) => (p.user_id === payload.user_id && payload.answered >= p.answered ? { ...p, ...payload } : p)) });
          if (payload.finished_at) refresh();
        } else refresh();
      },
      onPresence(list) {
        setOnline(list.map((p) => p.id));
        const known = new Set((viewRef.current?.players || []).map((p) => p.user_id));
        if (list.some((p) => !known.has(p.id))) refresh();
      },
      onStatus: setChannelState,
    });
    channelRef.current = ch;
    ch.send("joined", { user_id: player.id });
    return () => { ch.close(); channelRef.current = null; };
  }, [member, code, player.id]);
  useEffect(() => {
    if (!view || view.state === "done") return;
    const t = setInterval(refresh, channelState === "live" ? 20000 : 4000);
    return () => clearInterval(t);
  }, [view?.state, channelState, refresh]);

  const send = (event, payload = {}) => channelRef.current?.send(event, payload);
  async function act(fn, after) {
    setBusy(true); setError(null);
    try { const r = await fn(); if (r && typeof r === "object" && r.code) keep(r); after?.(r); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (loadError) return (
    <section className="wh-card lv-center">
      <h2>Challenge not available</h2>
      <p>{loadError}</p>
      <button className="lv-btn gold" onClick={onHome}>Back to Live Challenge</button>
    </section>
  );
  if (!view) return <div className="ui-page" aria-busy="true"><div className="ui-skeleton-row" /><div className="ui-skeleton-row" /><div className="ui-skeleton-row short" /></div>;

  const isHost = view.host_id === player.id;
  const serverMe = view.players.find((p) => p.user_id === player.id) || null;
  const me = serverMe && localMe && localMe.answered > serverMe.answered ? { ...serverMe, ...localMe } : serverMe;
  const common = { view, me, player, online, busy, error, isHost };

  if (!view.member) return <Invite {...common} onJoin={() => act(() => api.join(code), () => send("joined", { user_id: player.id }))} onHome={onHome} />;
  if (view.state === "lobby") return <Lobby {...common}
    onStart={() => act(() => api.start(code), () => { send("start"); refresh(); })}
    onLeave={() => act(() => api.leave(code), () => { send("left", { user_id: player.id }); onHome(); })}
    onRemove={(id) => act(() => api.removePlayer(code, id), () => { send("left", { user_id: id }); refresh(); })} />;
  if (view.state === "done") return <Results {...common} onHome={onHome} />;
  if (!me?.started_at) return <Ready {...common} onBegin={() => act(() => api.begin(code))} onLeave={() => act(() => api.leave(code), onHome)} />;
  if (!me.finished_at) return <Play {...common} api={api} code={code} onSeen={onSeen}
    onProgress={(row, done) => { setLocalMe(row); send("progress", { user_id: player.id, answered: row.answered, correct: row.correct, total_ms: row.total_ms, finished_at: row.finished_at, started_at: row.started_at }); if (done) { send("end"); refresh(); } else if (row.finished_at) refresh(); }}
    onFailed={refresh} />;
  return <Waiting {...common} onEnd={() => act(() => api.end(code), () => { send("end"); refresh(); })} />;
}

function Rules({ view }) {
  return <ul className="lv-rules">{rulesText(view).map((t) => <li key={t}>{t}</li>)}<li><Clock size={12} /> {timeLeft(view.expires_at)}</li></ul>;
}

function Invite({ view, busy, error, onJoin, onHome }) {
  const full = view.players.length >= view.max_players;
  const closed = view.state === "done" ? "This challenge has ended." : view.start_mode === "together" && view.state !== "lobby" ? "This challenge has already started." : full ? `This challenge is full (${view.max_players} players).` : null;
  return (
    <section className="wh-card lv-center lv-invite">
      <p className="lv-kicker">Live Challenge · {view.code}</p>
      <h2>{view.title}</h2>
      <p><b>{view.host}</b> invited you to play.</p>
      <Rules view={view} />
      <p className="lv-players-line"><Users size={14} /> {view.players.length}/{view.max_players}: {view.players.map((p) => p.username).join(", ")}</p>
      {closed ? <p className="lv-error">{closed}</p> : <button className="lv-btn gold big" disabled={busy} onClick={onJoin}>{busy ? "Joining…" : "Join the challenge"}</button>}
      {error && <p className="lv-error">{error}</p>}
      <button className="lv-btn ghost" onClick={onHome}>Not now</button>
    </section>
  );
}

function ShareBox({ view }) {
  const link = challengeLink(view.code);
  const [copied, setCopied] = useState(false);
  const message = `Join my Word Hunter challenge "${view.title}" (${view.question_count} questions): ${link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link:", link); } };
  const share = async () => { try { await navigator.share({ title: "Word Hunter challenge", text: message, url: link }); } catch {} };
  return (
    <div className="lv-share">
      <p className="lv-kicker">Send this link to one friend or a group</p>
      <div className="lv-link"><input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Challenge link" /><button className="lv-btn" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div>
      <div className="lv-row">
        {typeof navigator !== "undefined" && navigator.share && <button className="lv-btn ghost" onClick={share}><Share2 size={14} /> Share…</button>}
        <a className="lv-btn ghost" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <span className="lv-code" aria-label={`Code ${view.code}`}>{view.code}</span>
      </div>
    </div>
  );
}

function PlayerList({ view, player, online, isHost, onRemove }) {
  const here = new Set(online);
  return (
    <ul className="lv-people">
      {view.players.map((p) => (
        <li key={p.user_id}>
          <i className={`lv-dot ${here.has(p.user_id) || p.user_id === player.id ? "on" : ""}`} title={here.has(p.user_id) ? "Here now" : "Not here right now"} />
          <span className="lv-avatar">{p.username.slice(0, 1).toUpperCase()}</span>
          <b>{p.username}</b>
          {p.user_id === view.host_id && <small><Crown size={12} /> creator</small>}
          {p.user_id === player.id && <small>you</small>}
          {isHost && onRemove && p.user_id !== player.id && !p.started_at && <button className="lv-icon" onClick={() => onRemove(p.user_id)} aria-label={`Remove ${p.username}`} title="Remove"><UserMinus size={15} /></button>}
        </li>
      ))}
      {Array.from({ length: Math.max(0, Math.min(3, view.max_players - view.players.length)) }, (_, i) => <li key={`open-${i}`} className="open"><span className="lv-avatar">?</span><span>Open seat</span></li>)}
    </ul>
  );
}

function Lobby({ view, player, online, busy, error, isHost, onStart, onLeave, onRemove }) {
  const enough = view.players.length >= MIN_PLAYERS;
  return (
    <section className="wh-card lv-lobby">
      <div className="lv-form-head"><div><p className="lv-kicker">Waiting room · {view.players.length}/{view.max_players} players</p><h2>{view.title}</h2></div></div>
      <Rules view={view} />
      <ShareBox view={view} />
      <PlayerList view={view} player={player} online={online} isHost={isHost} onRemove={onRemove} />
      {isHost
        ? <div className="lv-row"><button className="lv-btn gold big" disabled={busy || !enough} onClick={onStart}><PlayIcon size={16} /> {enough ? `Start for ${view.players.length} players` : "Waiting for someone to join…"}</button><button className="lv-btn ghost" disabled={busy} onClick={onLeave}>Cancel challenge</button></div>
        : <div className="lv-row"><p className="lv-wait">Waiting for <b>{view.host}</b> to start…</p><button className="lv-btn ghost" disabled={busy} onClick={onLeave}><LogOut size={14} /> Leave</button></div>}
      {error && <p className="lv-error">{error}</p>}
    </section>
  );
}

function Ready({ view, busy, error, onBegin, onLeave }) {
  const together = view.start_mode === "together";
  const [count, setCount] = useState(together ? 3 : null);
  useEffect(() => {
    if (count == null) return;
    if (count === 0) { onBegin(); return; }
    const t = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(t);
  }, [count]);
  return (
    <section className="wh-card lv-center">
      <p className="lv-kicker">{view.title}</p>
      {together ? <><h2>Get ready…</h2><div className="lv-countdown" aria-live="assertive">{count > 0 ? count : "Go!"}</div></> : <>
        <h2>Ready when you are</h2>
        <Rules view={view} />
        <p>Your clock starts when you press Start. Others play on their own time; the board updates as they finish.</p>
        <button className="lv-btn gold big" disabled={busy} onClick={onBegin}><PlayIcon size={16} /> Start</button>
        <button className="lv-btn ghost" disabled={busy} onClick={onLeave}>Leave</button>
      </>}
      {error && <p className="lv-error">{error}</p>}
    </section>
  );
}

function Race({ view, player, online }) {
  const here = new Set(online);
  return (
    <ol className="lv-race">
      {standings(view.players).map((p, i) => (
        <li key={p.user_id} className={p.user_id === player.id ? "me" : ""}>
          <span className="lv-race-name">{i + 1}. {p.username}{p.finished_at ? <CheckCircle2 size={13} className="lv-ok" /> : !here.has(p.user_id) && p.user_id !== player.id && !p.started_at ? <small> not started</small> : null}</span>
          <span className="lv-race-bar" aria-hidden="true"><i style={{ width: `${(p.answered / view.question_count) * 100}%` }} /></span>
          <span className="lv-race-num">{p.correct} ✓ · {formatMs(p.total_ms)}</span>
        </li>
      ))}
    </ol>
  );
}

function Play({ view, me, player, online, api, code, onSeen, onProgress, onFailed }) {
  const idx = me.answered;
  const q = view.questions[idx];
  const reveal = view.settings?.reveal !== false;
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(null);
  const [problem, setProblem] = useState(null);
  const [now, setNow] = useState(() => performance.now());
  const shownAt = useRef(performance.now());
  const limit = view.seconds * 1000;
  useEffect(() => { shownAt.current = performance.now(); setNow(performance.now()); }, [idx]);
  useEffect(() => {
    if (!limit || feedback || pending) return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [idx, limit, feedback, pending]);
  const left = limit ? Math.max(0, limit - (now - shownAt.current)) : null;

  async function submit(choice) {
    if (pending || feedback) return;
    const ms = performance.now() - shownAt.current;
    setPending({ choice }); setProblem(null);
    try {
      const r = await withRetry(() => api.answer(code, idx, choice, ms));
      if (r.sentences?.length) onSeen({ mode: q.mode, prompt: q.prompt, sentences: r.sentences });
      setFeedback({ ...r, choice });
      setTimeout(() => { setFeedback(null); setPending(null); onProgress(r.me, r.done); }, r.correct ? FEEDBACK_MS.correct : reveal ? FEEDBACK_MS.wrong : FEEDBACK_MS.correct);
    } catch (e) {
      setPending(null); setProblem(e.message); onFailed();
    }
  }
  useEffect(() => { if (limit && left === 0 && !pending && !feedback) submit(null); }, [left]);
  useEffect(() => {
    const onKey = (e) => { const n = Number(e.key); if (n >= 1 && n <= (q?.options.length || 0)) submit(q.options[n - 1]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!q) return null;
  const picked = feedback?.choice ?? pending?.choice;
  return (
    <div className="lv-play">
      <section className="wh-card lv-question">
        <div className="lv-qtop">
          <span>Question {idx + 1}/{view.question_count}</span>
          <span className="lv-score">{me.correct} ✓</span>
          {limit ? <span className={`lv-timer ${left <= 5000 ? "urgent" : ""}`}><Timer size={13} /> {Math.ceil(left / 1000)}s</span> : <span className="lv-timer"><Clock size={13} /> {formatMs(now - shownAt.current)}</span>}
        </div>
        <div className="wh-session-progress"><span style={{ width: `${limit ? (left / limit) * 100 : (idx / view.question_count) * 100}%` }} /></div>
        {(q.picture || q.photo) && <div className="wh-picture-q"><WordPicture word={q} className="wh-picture-img" /></div>}
        <p className="wh-sentence">{q.mode === "meaning" ? <>What does <b>{q.prompt}</b> mean?</> : q.prompt}</p>
        <div className="wh-options">
          {q.options.map((opt, i) => {
            const isPicked = picked != null && opt === picked;
            const cls = feedback ? (reveal && feedback.answer != null && opt.trim().toLowerCase() === String(feedback.answer).trim().toLowerCase() ? "correct" : isPicked ? (feedback.correct ? "correct" : "wrong") : "") : isPicked ? "picked" : "";
            return <button key={opt} type="button" className={`wh-option ${cls}`} disabled={!!pending || !!feedback} onClick={() => submit(opt)}><span className="wh-shortcut-key" aria-hidden="true">{i + 1}</span>{liveOption(opt, q)}</button>;
          })}
        </div>
        <div className="lv-feedback" role="status">
          {pending && !feedback && <span className="lv-muted">Checking…</span>}
          {feedback && (feedback.correct ? <b className="good">Correct!</b> : <b className="bad">{feedback.choice == null ? "Time's up" : "Not quite"}{reveal && feedback.answer ? ` · it was ${feedback.answer}` : ""}</b>)}
          {feedback && reveal && feedback.explanation && q.mode !== "meaning" && <small>{feedback.word}: {feedback.explanation}</small>}
          {problem && <span className="lv-error">{problem}</span>}
        </div>
      </section>
      <aside className="lv-side"><h3>Race</h3><Race view={view} player={player} online={online} /></aside>
    </div>
  );
}

function Waiting({ view, me, player, online, busy, error, isHost, onEnd }) {
  const left = view.players.filter((p) => !p.finished_at).length;
  return (
    <section className="wh-card lv-center">
      <p className="lv-kicker">{view.title}</p>
      <h2>You finished!</h2>
      <p className="lv-big-score">{me.correct}/{view.question_count} right · {formatMs(me.total_ms)}</p>
      <p>{view.start_mode === "anytime" && view.players.length < view.max_players
        ? `The challenge stays open for others (${timeLeft(view.expires_at)}). Results are final when it's full or time runs out.`
        : `Waiting for ${left} player${left === 1 ? "" : "s"} to finish…`}</p>
      <Race view={view} player={player} online={online} />
      {view.start_mode === "anytime" && view.players.length < view.max_players && <ShareBox view={view} />}
      {isHost && <button className="lv-btn ghost" disabled={busy} onClick={onEnd}>End the challenge now</button>}
      {error && <p className="lv-error">{error}</p>}
    </section>
  );
}

function Results({ view, player, onHome }) {
  const ranked = [...view.players].filter((p) => p.rank != null).sort((a, b) => a.rank - b.rank || a.total_ms - b.total_ms);
  const winners = ranked.filter((p) => p.rank === 1);
  const myAnswers = new Map((view.my_answers || []).map((a) => [a.idx, a]));
  const [showReview, setShowReview] = useState(false);
  return (
    <section className="wh-card lv-results">
      <p className="lv-kicker">{view.title} · final</p>
      <h2 className="lv-winner"><Trophy size={22} /> {!winners.length ? "Nobody played" : winners.length > 1 ? `Tie: ${winners.map((w) => w.username).join(" & ")}` : winners[0].user_id === player.id ? "You win!" : `${winners[0].username} wins`}</h2>
      {ranked.length > 0 && <table className="lv-table">
        <thead><tr><th>#</th><th>Player</th><th className="num">Right</th><th className="num">Time</th></tr></thead>
        <tbody>{ranked.map((p) => (
          <tr key={p.user_id} className={p.user_id === player.id ? "me" : ""}>
            <td>{p.rank === 1 ? "🏆" : p.rank}</td>
            <td>{p.username}{!p.finished_at && <small> (didn't finish)</small>}</td>
            <td className="num">{p.correct}/{view.question_count}</td>
            <td className="num">{formatMs(p.total_ms)}</td>
          </tr>
        ))}</tbody>
      </table>}
      <p className="lv-note">Most right answers wins. A tie goes to whoever finished, then to the fastest total time.</p>
      {view.key && <>
        <button className="lv-btn ghost" onClick={() => setShowReview((v) => !v)}>{showReview ? "Hide my answers" : "Review my answers"}</button>
        {showReview && <ol className="lv-review">{view.questions.map((q, i) => {
          const a = myAnswers.get(i), k = view.key[i] || {};
          return <li key={i} className={a?.correct ? "good" : "bad"}>
            <span>{q.mode === "meaning" ? <>What does <b>{q.prompt}</b> mean?</> : q.prompt}</span>
            <small>{a ? (a.correct ? <>✓ {a.choice}</> : <>✗ {a.choice ?? "no answer"} · right: <b>{k.answer}</b></>) : <>not answered · right: <b>{k.answer}</b></>}{a ? ` · ${formatMs(a.ms)}` : ""}</small>
          </li>;
        })}</ol>}
      </>}
      <div className="lv-row"><button className="lv-btn gold" onClick={onHome}>New challenge</button></div>
    </section>
  );
}
