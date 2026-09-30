import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { V2 } from "../../engine/v2";
import { WordPicture } from "../media/media";
import { storage } from "../../lib/legacyStorage";
import { levelGroups } from "../../engine/data";
import { LIVE_CODE_CHARS, LIVE_GRACE_MS, LIVE_HOST_GONE_MS, LIVE_POLL_MS, LIVE_REVEAL_MS, liveBoard, liveOption, livePoints, liveQuestions, liveStore } from "./liveEngine";
export function LiveChallenge({ levels, onExit, pools = null, getSeen = () => ({}), onSeen = () => {}, onRefresh = () => {} }) {
  const [me] = useState(() => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("menu"); // menu | host | join | room
  const [isHost, setIsHost] = useState(false);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [levelIndex, setLevelIndex] = useState(0);
  const [unit, setUnit] = useState("");
  const [count, setCount] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [joinCode, setJoinCode] = useState("");
  const [myAnswers, setMyAnswers] = useState({});
  const [now, setNow] = useState(Date.now());
  const roomRef = useRef(null), answersRef = useRef({}), shownAtRef = useRef({}), changedAtRef = useRef(Date.now());
  const shared = !!(window.storage?.set && window.storage?.list);

  useEffect(() => { storage.get("live-name").then((r) => { if (r?.value) setName(String(r.value)); }).catch(() => {}); }, []);
  const rememberName = () => storage.set("live-name", name.trim()).catch(() => {});
  const takeRoom = (r) => { if (JSON.stringify(r) !== JSON.stringify(roomRef.current)) changedAtRef.current = Date.now(); roomRef.current = r; setRoom(r); };

  const level = levels[levelIndex];
  const groups = level ? levelGroups(level).filter((g) => g.id) : [];
  const words = level ? level.items.filter((it) => it.kind === "word").map((it) => it.obj).filter((w) => !unit || (groups[0]?.field === "unit" ? (w.units || []).includes(unit) : w.subCategory === unit)) : [];

  async function createRoom() {
    setError(null);
    const questions = liveQuestions(words, count, { pools, seen: getSeen() });
    if (questions.length < 3) { setError("Not enough words with safe multiple-choice questions here. Pick another lesson."); return; }
    setBusy(true);
    try {
      let c = "";
      for (let tries = 0; tries < 6; tries++) { c = Array.from({ length: 4 }, () => LIVE_CODE_CHARS[Math.floor(Math.random() * LIVE_CODE_CHARS.length)]).join(""); if (!(await liveStore.get(`live:${c}`))) break; }
      const title = unit ? `${level.title} · ${groups.find((g) => g.id === unit)?.title || unit}` : level.title;
      const r = { v: 1, code: c, host: me, title, seconds, questions, state: "lobby", index: 0, phaseAt: Date.now(), players: [{ id: me, name: name.trim(), answers: {} }] };
      await liveStore.set(`live:${c}:p:${me}`, { id: me, name: name.trim(), answers: {} });
      await liveStore.set(`live:${c}`, r);
      rememberName(); setIsHost(true); setCode(c); takeRoom(r); setPhase("room");
      onRefresh(words);
    } catch (problem) { setError(`Couldn't create the challenge: ${problem.message || problem}`); }
    setBusy(false);
  }
  async function joinRoom() {
    setError(null);
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) { setError("The code is 4 letters/numbers."); return; }
    setBusy(true);
    try {
      const r = await liveStore.get(`live:${c}`);
      if (!r) setError("No challenge with this code. Check it with your friend.");
      else if (r.state !== "lobby") setError("This challenge has already started.");
      else { await liveStore.set(`live:${c}:p:${me}`, { id: me, name: name.trim(), answers: {} }); rememberName(); setIsHost(false); setCode(c); takeRoom(r); setPhase("room"); }
    } catch (problem) { setError(`Couldn't join: ${problem.message || problem}`); }
    setBusy(false);
  }
  async function startGame() {
    const r = { ...roomRef.current, state: "question", index: 0, phaseAt: Date.now() };
    try { await liveStore.set(`live:${code}`, r); takeRoom(r); } catch (problem) { setError(`Couldn't start: ${problem.message || problem}`); }
  }

  // Everyone: follow the room. The host also gathers the players' answers
  // into it and moves on when all have answered or the time is up.
  useEffect(() => {
    if (phase !== "room" || !code) return;
    let stopped = false, running = false;
    const tick = async () => {
      if (running || stopped) return; running = true;
      try {
        if (!isHost) { const r = await liveStore.get(`live:${code}`); if (r && !stopped) takeRoom(r); }
        else {
          const cur = roomRef.current; if (!cur || cur.state === "done") return;
          const keys = await liveStore.list(`live:${code}:p:`);
          const found = (await Promise.all(keys.map((k) => liveStore.get(k)))).filter((p) => p && p.id);
          const players = cur.state === "lobby" ? found.map((p) => ({ id: p.id, name: p.name, answers: {} }))
            : cur.players.map((p) => { const f = found.find((x) => x.id === p.id); return f ? { ...p, answers: f.answers || {} } : p; });
          const next = { ...cur, players };
          const per = cur.seconds * 1000, t = Date.now();
          if (cur.state === "question") { const i = cur.index; if (players.every((p) => p.answers?.[i]) || t - cur.phaseAt > per + LIVE_GRACE_MS) { next.state = "reveal"; next.phaseAt = t; } }
          else if (cur.state === "reveal" && t - cur.phaseAt > LIVE_REVEAL_MS) { if (cur.index + 1 >= cur.questions.length) { next.state = "done"; next.phaseAt = t; } else { next.state = "question"; next.index = cur.index + 1; next.phaseAt = t; } }
          if (!stopped && JSON.stringify(next) !== JSON.stringify(cur)) { await liveStore.set(`live:${code}`, next); takeRoom(next); }
        }
      } catch (_) {} finally { running = false; }
    };
    tick();
    const t = setInterval(tick, LIVE_POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [phase, code, isHost]);

  const q = room?.state === "question" || room?.state === "reveal" ? room.questions[room.index] : null;
  const per = (room?.seconds || 20) * 1000;
  useEffect(() => { if (room?.state === "question" && !shownAtRef.current[room.index]) shownAtRef.current[room.index] = Date.now(); }, [room?.state, room?.index]);
  useEffect(() => { if (phase !== "room") return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [phase]);
  // Every player remembers the sentences a question showed, so neither the
  // next match nor their normal rounds bring them straight back.
  const markedRef = useRef(new Set());
  useEffect(() => {
    if (!room || (room.state !== "reveal" && room.state !== "done")) return;
    const key = `${room.code}:${room.index}`;
    if (markedRef.current.has(key)) return;
    markedRef.current.add(key);
    const qq = room.questions[room.index];
    if (qq?.sentences?.length) onSeen({ mode: qq.mode, prompt: qq.prompt, sentences: qq.sentences });
  }, [room?.state, room?.index]);
  const shownAt = room ? shownAtRef.current[room.index] : null;
  const timeLeft = room?.state === "question" && shownAt ? Math.max(0, per - (now - shownAt)) : 0;
  const mine = room ? myAnswers[room.index] : null;

  async function answer(choice) {
    const cur = roomRef.current; if (!cur || cur.state !== "question") return;
    const i = cur.index; if (answersRef.current[i]) return;
    const qq = cur.questions[i];
    const a = { choice, correct: choice != null && V2.norm(choice) === V2.norm(qq.answer), ms: Math.min(per, Date.now() - (shownAtRef.current[i] || Date.now())) };
    const answers = { ...answersRef.current, [i]: a };
    answersRef.current = answers; setMyAnswers(answers);
    try { await liveStore.set(`live:${code}:p:${me}`, { id: me, name: name.trim(), answers }); } catch (_) {}
  }
  useEffect(() => { if (room?.state === "question" && shownAt && timeLeft <= 0 && !answersRef.current[room.index]) answer(null); }, [timeLeft, room?.state]);
  useEffect(() => {
    if (room?.state !== "question" || mine) return;
    const onKey = (e) => { const n = Number(e.key); if (n >= 1 && n <= (q?.options.length || 0)) answer(q.options[n - 1]); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [room?.state, room?.index, mine]);

  function leave() { setPhase("menu"); setRoom(null); roomRef.current = null; setCode(""); setMyAnswers({}); answersRef.current = {}; shownAtRef.current = {}; setIsHost(false); setError(null); }
  const hostGone = !isHost && room && room.state !== "done" && room.state !== "lobby" && now - changedAtRef.current > per + LIVE_HOST_GONE_MS;
  const nameOk = name.trim().length >= 2;

  if (phase !== "room") return <div className="wh-card wh-live">
    <div className="wh-live-head"><h2><Users size={18} /> Live Challenge</h2><button className="wh-back-btn" onClick={phase === "menu" ? onExit : () => { setPhase("menu"); setError(null); }}>{phase === "menu" ? "Back" : "← Back"}</button></div>
    {!shared && <p className="wh-import-error">Shared storage isn't available in this preview. Open the game from its published link on both devices.</p>}
    {phase === "menu" && <>
      <p>Play the same questions with a friend at the same time, each on your own device. Right answers score 500 points, plus up to 500 more for speed.</p>
      <label className="wh-live-field"><span>Your name</span><input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Khaled" /></label>
      <div className="wh-live-actions"><button className="wh-level-btn" disabled={!nameOk || !levels.length} onClick={() => setPhase("host")}>Create a challenge</button><button className="wh-level-btn" disabled={!nameOk} onClick={() => setPhase("join")}>Join with a code</button></div>
      {!levels.length && <p><small>You need imported words to create a challenge. You can still join one.</small></p>}
      <p><small>Everyone who opens this game's published link can see challenge names and scores.</small></p>
    </>}
    {phase === "host" && <>
      <label className="wh-live-field"><span>Lesson</span><select value={levelIndex} onChange={(e) => { setLevelIndex(Number(e.target.value)); setUnit(""); }}>{levels.map((l, i) => <option key={l.title} value={i}>{l.title}</option>)}</select></label>
      {groups.length > 1 && <label className="wh-live-field"><span>{groups[0].field === "unit" ? "Unit" : "Group"}</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">All</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>}
      <label className="wh-live-field"><span>Questions</span><select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="wh-live-field"><span>Seconds per question</span><select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>{[10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <p><small>{words.length} words to pick from.</small></p>
      <button className="wh-level-btn" disabled={busy || !shared} onClick={createRoom}>{busy ? "Creating…" : "Create"}</button>
    </>}
    {phase === "join" && <>
      <label className="wh-live-field"><span>Challenge code</span><input className="wh-live-code-input" value={joinCode} maxLength={4} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") joinRoom(); }} placeholder="ABCD" /></label>
      <button className="wh-level-btn" disabled={busy || !shared || joinCode.trim().length !== 4} onClick={joinRoom}>{busy ? "Joining…" : "Join"}</button>
    </>}
    {error && <p className="wh-import-error">{error}</p>}
  </div>;

  if (!room) return null;
  const board = liveBoard(room, room.state === "question" ? room.index - 1 : room.index);
  const answeredIds = new Set((room.players || []).filter((p) => p.answers?.[room.index]).map((p) => p.id));
  if (mine) answeredIds.add(me);
  const Board = ({ final }) => <ol className="wh-live-board">{board.map((p, i) => <li key={p.id} className={p.id === me ? "me" : ""}><span>{final && i === 0 && board.length > 1 && p.points > (board[1]?.points || 0) ? "🏆 " : `${i + 1}. `}{p.name}{p.id === me ? " (you)" : ""}</span><span>{p.correct} right · <b>{p.points}</b></span></li>)}</ol>;

  return <div className="wh-card wh-live">
    <div className="wh-live-head"><h2><Users size={18} /> {room.title}</h2><button className="wh-back-btn" onClick={leave}>Leave</button></div>
    {room.state === "lobby" && <>
      <p>Share this code with your friend. They open the game, tap <b>Live Challenge → Join with a code</b>, and type it.</p>
      <div className="wh-live-code">{room.code}</div>
      <p><b>Players ({room.players.length})</b></p>
      <ul className="wh-live-players">{room.players.map((p) => <li key={p.id}>{p.name}{p.id === room.host ? " · host" : ""}{p.id === me ? " (you)" : ""}</li>)}</ul>
      <p><small>{room.questions.length} questions · {room.seconds}s each</small></p>
      {isHost ? <button className="wh-level-btn" disabled={room.players.length < 2} onClick={startGame}>{room.players.length < 2 ? "Waiting for a friend to join…" : `Start (${room.players.length} players)`}</button> : <p>Waiting for the host to start…</p>}
    </>}
    {q && <>
      <div className="wh-live-status"><span>Question {room.index + 1}/{room.questions.length}</span><span className={room.state === "question" && timeLeft <= 5000 ? "urgent" : ""}>{room.state === "question" ? `${Math.ceil(timeLeft / 1000)}s` : "Time's up"}</span></div>
      <div className="wh-session-progress"><span style={{ width: `${room.state === "question" ? (timeLeft / per) * 100 : 0}%` }} /></div>
      {(q.picture || q.photo) && <div className="wh-picture-q"><WordPicture word={q} className="wh-picture-img" /></div>}
      <p className="wh-sentence">{q.mode === "meaning" ? <>What does <b>{q.prompt}</b> mean?</> : q.prompt}</p>
      <div className="wh-options">{q.options.map((opt, i) => {
        const reveal = room.state === "reveal";
        const cls = reveal ? (V2.norm(opt) === V2.norm(q.answer) ? "correct" : mine?.choice === opt ? "wrong" : "") : mine?.choice === opt ? "picked" : "";
        return <button key={opt} type="button" className={`wh-option ${cls}`} disabled={!!mine || reveal} onClick={() => answer(opt)}><span className="wh-shortcut-key" aria-hidden="true">{i + 1}</span>{liveOption(opt, q)}</button>;
      })}</div>
      {room.state === "question" && <p className="wh-live-waiting">{mine ? "Answer locked in. " : ""}{room.players.map((p) => <span key={p.id} className={answeredIds.has(p.id) ? "done" : ""}>{answeredIds.has(p.id) ? "✓" : "…"} {p.name}</span>)}</p>}
      {room.state === "reveal" && <>
        <div role="status" className={`wh-feedback ${mine?.correct ? "correct" : "wrong"}`}>{mine?.correct ? `Correct! +${livePoints(mine, per)}` : mine?.choice == null ? `Time's up — it was: ${q.answer}` : `It was: ${q.answer}`}</div>
        {q.explanation && q.mode !== "meaning" && <p><small>{q.word}: {q.explanation}</small></p>}
        <Board />
      </>}
    </>}
    {room.state === "done" && <>
      <div className="wh-results-stamp">Final score</div>
      <Board final />
      <div className="wh-live-actions"><button className="wh-level-btn" onClick={leave}>New challenge</button><button className="wh-back-btn" onClick={onExit}>Back to levels</button></div>
    </>}
    {hostGone && <p className="wh-import-error">The host seems to have left. You can leave this challenge.</p>}
  </div>;
}
