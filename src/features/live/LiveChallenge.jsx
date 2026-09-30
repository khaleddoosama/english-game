import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { V2 } from "../../engine/v2";
import { WordPicture } from "../media/media";
import { levelGroups } from "../../engine/data";
import { LIVE_GRACE_MS, LIVE_REVEAL_MS, liveBoard, liveOption, livePoints, liveQuestions } from "./liveEngine";
import { liveRooms, openLiveChannel } from "./transport";

// Live Challenge: two or more players, each on their own device, answer the
// same questions at the same time. The room's questions are stored once
// (live_rooms); everything else travels over a realtime channel:
//   presence  who is in the room (a player who closes the app drops out at once)
//   "room"    host -> everyone: state, question index, players' answers
//   "answer"  player -> host: one answer with the time it took on their device
//   "sync"    a (re)joining player asks the host for the current state
// The host runs the clock and moves the game on. Answer times are measured on
// each player's own device, so clocks never have to agree.
const HOST_GONE_MS = 5000;

function preloadPictures(questions) {
  if (typeof Image === "undefined") return;
  for (const q of questions || []) {
    const src = typeof q.photo === "string" ? q.photo : null;
    if (src && /^https?:/.test(src)) { const img = new Image(); img.decoding = "async"; img.referrerPolicy = "no-referrer"; img.src = src; }
  }
}

export function LiveChallenge({ levels, onExit, pools = null, getSeen = () => ({}), onSeen = () => {}, onRefresh = () => {}, player }) {
  const me = player.id;
  const name = player.name;
  const [phase, setPhase] = useState("menu"); // menu | host | join | room
  const [isHost, setIsHost] = useState(false);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState(null);
  const [present, setPresent] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [levelIndex, setLevelIndex] = useState(0);
  const [unit, setUnit] = useState("");
  const [count, setCount] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [joinCode, setJoinCode] = useState("");
  const [myAnswers, setMyAnswers] = useState({});
  const [now, setNow] = useState(Date.now());
  const roomRef = useRef(null), answersRef = useRef({}), shownAtRef = useRef({}), channelRef = useRef(null);
  const seqRef = useRef(0), presentRef = useRef([]), hostSeenAtRef = useRef(Date.now()), savedRef = useRef(false);
  const takeRoom = (r) => { roomRef.current = r; setRoom(r); };

  const level = levels[levelIndex];
  const groups = level ? levelGroups(level).filter((g) => g.id) : [];
  const words = level ? level.items.filter((it) => it.kind === "word").map((it) => it.obj).filter((w) => !unit || (groups[0]?.field === "unit" ? (w.units || []).includes(unit) : w.subCategory === unit)) : [];

  // --- host: the only writer of room state -----------------------------
  function broadcast(r) {
    seqRef.current += 1;
    const { questions, ...state } = r;
    channelRef.current?.send("room", { ...state, seq: seqRef.current });
  }
  function hostUpdate(mutate) {
    const cur = roomRef.current;
    if (!cur) return;
    const next = mutate(cur);
    if (!next || next === cur) return;
    takeRoom(next);
    broadcast(next);
  }
  function hostSeesPresence(list) {
    hostUpdate((cur) => {
      if (cur.state === "lobby") {
        const players = list.map((p) => ({ id: p.id, name: p.name, answers: {} }));
        if (!players.some((p) => p.id === me)) players.unshift({ id: me, name, answers: {} });
        return JSON.stringify(players.map((p) => p.id)) === JSON.stringify(cur.players.map((p) => p.id)) ? cur : { ...cur, players };
      }
      return { ...cur }; // re-broadcast so everyone sees who dropped out
    });
    maybeReveal();
  }
  function hostTakesAnswer({ id, index, answer }) {
    hostUpdate((cur) => {
      if (cur.state !== "question" || index !== cur.index) return cur;
      const players = cur.players.map((p) => (p.id === id && !p.answers?.[index] ? { ...p, answers: { ...p.answers, [index]: answer } } : p));
      return { ...cur, players };
    });
    maybeReveal();
  }
  // Everyone still here has answered: reveal without waiting for the clock.
  function maybeReveal() {
    const cur = roomRef.current;
    if (!cur || cur.state !== "question") return;
    const here = new Set(presentRef.current.map((p) => p.id)); here.add(me);
    const waiting = cur.players.filter((p) => here.has(p.id) && !p.answers?.[cur.index]);
    if (!waiting.length) hostUpdate((r) => ({ ...r, state: "reveal", phaseAt: Date.now() }));
  }

  function connect(r, host) {
    channelRef.current?.close();
    savedRef.current = false; seqRef.current = 0; hostSeenAtRef.current = Date.now();
    takeRoom(r); setIsHost(host); setCode(r.code); setPhase("room");
    preloadPictures(r.questions);
    const channel = openLiveChannel(r.code, { id: me, name, host }, {
      onPresence(list) {
        presentRef.current = list; setPresent(list);
        if (list.some((p) => p.id === roomRef.current?.host)) hostSeenAtRef.current = Date.now();
        if (host) hostSeesPresence(list);
      },
      onEvent(event, payload) {
        if (host) {
          if (event === "answer") hostTakesAnswer(payload);
          else if (event === "sync") broadcast(roomRef.current);
        } else if (event === "room" && payload.seq > seqRef.current) {
          seqRef.current = payload.seq;
          hostSeenAtRef.current = Date.now();
          takeRoom({ ...roomRef.current, ...payload });
        }
      },
    });
    channelRef.current = channel;
    channel.ready.then(() => { if (!host) channel.send("sync", {}); }).catch((problem) => setError(`Live connection failed: ${problem.message || problem}`));
  }
  useEffect(() => () => channelRef.current?.close(), []);

  async function createRoom() {
    setError(null);
    const questions = liveQuestions(words, count, { pools, seen: getSeen() });
    if (questions.length < 3) { setError("Not enough words with safe multiple-choice questions here. Pick another lesson."); return; }
    setBusy(true);
    try {
      const title = unit ? `${level.title} · ${groups.find((g) => g.id === unit)?.title || unit}` : level.title;
      const c = await liveRooms.create({ title, seconds, questions, hostId: me });
      connect({ v: 2, code: c, host: me, title, seconds, questions, state: "lobby", index: 0, phaseAt: Date.now(), players: [{ id: me, name, answers: {} }] }, true);
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
      const stored = await liveRooms.get(c);
      if (!stored) setError("No challenge with this code. Check it with your friend.");
      else if (stored.state !== "lobby") setError("This challenge has already started.");
      else connect({ v: 2, code: c, host: stored.host_id, title: stored.title, seconds: stored.seconds, questions: stored.questions, state: "lobby", index: 0, phaseAt: Date.now(), players: [] }, false);
    } catch (problem) { setError(`Couldn't join: ${problem.message || problem}`); }
    setBusy(false);
  }
  function startGame() {
    hostUpdate((cur) => ({ ...cur, state: "question", index: 0, phaseAt: Date.now() }));
    liveRooms.setState(code, "playing").catch(() => {});
  }

  // Host clock: time's up -> reveal; reveal shown -> next question or done.
  useEffect(() => {
    if (phase !== "room") return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (!isHost) return;
      const cur = roomRef.current;
      if (!cur) return;
      const per = cur.seconds * 1000, t0 = Date.now();
      if (cur.state === "question" && t0 - cur.phaseAt > per + LIVE_GRACE_MS) hostUpdate((r) => ({ ...r, state: "reveal", phaseAt: t0 }));
      else if (cur.state === "reveal" && t0 - cur.phaseAt > LIVE_REVEAL_MS) {
        hostUpdate((r) => (r.index + 1 >= r.questions.length ? { ...r, state: "done", phaseAt: t0 } : { ...r, state: "question", index: r.index + 1, phaseAt: t0 }));
        if (cur.index + 1 >= cur.questions.length) liveRooms.setState(code, "done").catch(() => {});
      }
    }, 250);
    return () => clearInterval(t);
  }, [phase, isHost, code]);

  const q = room?.state === "question" || room?.state === "reveal" ? room.questions[room.index] : null;
  const per = (room?.seconds || 20) * 1000;
  useEffect(() => { if (room?.state === "question" && !shownAtRef.current[room.index]) shownAtRef.current[room.index] = Date.now(); }, [room?.state, room?.index]);
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
  // Final result goes to the leaderboard once.
  useEffect(() => {
    if (room?.state !== "done" || savedRef.current) return;
    savedRef.current = true;
    const board = liveBoard(room, room.questions.length - 1);
    const rank = board.findIndex((p) => p.id === me) + 1;
    const mine = board[rank - 1];
    if (mine) liveRooms.saveResult({ room_code: room.code, title: room.title, points: mine.points, correct: mine.correct, total: room.questions.length, rank, players: board.length });
  }, [room?.state]);
  const shownAt = room ? shownAtRef.current[room.index] : null;
  const timeLeft = room?.state === "question" && shownAt ? Math.max(0, per - (now - shownAt)) : 0;
  const mine = room ? myAnswers[room.index] : null;

  function answer(choice) {
    const cur = roomRef.current; if (!cur || cur.state !== "question") return;
    const i = cur.index; if (answersRef.current[i]) return;
    const qq = cur.questions[i];
    const a = { choice, correct: choice != null && V2.norm(choice) === V2.norm(qq.answer), ms: Math.min(per, Date.now() - (shownAtRef.current[i] || Date.now())) };
    answersRef.current = { ...answersRef.current, [i]: a }; setMyAnswers(answersRef.current);
    if (isHost) hostTakesAnswer({ id: me, index: i, answer: a });
    else channelRef.current?.send("answer", { id: me, index: i, answer: a });
  }
  useEffect(() => { if (room?.state === "question" && shownAt && timeLeft <= 0 && !answersRef.current[room.index]) answer(null); }, [timeLeft, room?.state]);
  useEffect(() => {
    if (room?.state !== "question" || mine) return;
    const onKey = (e) => { const n = Number(e.key); if (n >= 1 && n <= (q?.options.length || 0)) answer(q.options[n - 1]); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [room?.state, room?.index, mine]);

  function leave() { channelRef.current?.close(); channelRef.current = null; setPhase("menu"); takeRoom(null); setCode(""); setMyAnswers({}); answersRef.current = {}; shownAtRef.current = {}; setIsHost(false); setError(null); setPresent([]); }
  const hostGone = !isHost && room && room.state !== "done" && now - hostSeenAtRef.current > HOST_GONE_MS && !present.some((p) => p.id === room.host);
  const hereIds = new Set(present.map((p) => p.id));

  if (phase !== "room") return <div className="wh-card wh-live">
    <div className="wh-live-head"><h2><Users size={18} /> Live Challenge</h2><button className="wh-back-btn" onClick={phase === "menu" ? onExit : () => { setPhase("menu"); setError(null); }}>{phase === "menu" ? "Back" : "← Back"}</button></div>
    {phase === "menu" && <>
      <p>Play the same questions with a friend at the same time, each on your own device. Right answers score 500 points, plus up to 500 more for speed.</p>
      <p className="wh-live-you">Playing as <b>{name}</b></p>
      <div className="wh-live-actions"><button className="wh-level-btn" disabled={!levels.length} onClick={() => setPhase("host")}>Create a challenge</button><button className="wh-level-btn" onClick={() => setPhase("join")}>Join with a code</button></div>
      {!levels.length && <p><small>There are no words yet to build a challenge from. You can still join one.</small></p>}
    </>}
    {phase === "host" && <>
      <label className="wh-live-field"><span>Lesson</span><select value={levelIndex} onChange={(e) => { setLevelIndex(Number(e.target.value)); setUnit(""); }}>{levels.map((l, i) => <option key={l.title} value={i}>{l.title}</option>)}</select></label>
      {groups.length > 1 && <label className="wh-live-field"><span>{groups[0].field === "unit" ? "Unit" : "Group"}</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">All</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>}
      <label className="wh-live-field"><span>Questions</span><select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="wh-live-field"><span>Seconds per question</span><select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>{[10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <p><small>{words.length} words to pick from.</small></p>
      <button className="wh-level-btn" disabled={busy} onClick={createRoom}>{busy ? "Creating…" : "Create"}</button>
    </>}
    {phase === "join" && <>
      <label className="wh-live-field"><span>Challenge code</span><input className="wh-live-code-input" value={joinCode} maxLength={4} autoCapitalize="characters" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") joinRoom(); }} placeholder="ABCD" /></label>
      <button className="wh-level-btn" disabled={busy || joinCode.trim().length !== 4} onClick={joinRoom}>{busy ? "Joining…" : "Join"}</button>
    </>}
    {error && <p className="wh-import-error">{error}</p>}
  </div>;

  if (!room) return null;
  const board = liveBoard(room, room.state === "question" ? room.index - 1 : room.index);
  const answeredIds = new Set((room.players || []).filter((p) => p.answers?.[room.index]).map((p) => p.id));
  if (mine) answeredIds.add(me);
  const lobbyPlayers = isHost || room.players.length ? room.players : present.map((p) => ({ id: p.id, name: p.name }));
  const Board = ({ final }) => <ol className="wh-live-board">{board.map((p, i) => <li key={p.id} className={p.id === me ? "me" : ""}><span>{final && i === 0 && board.length > 1 && p.points > (board[1]?.points || 0) ? "🏆 " : `${i + 1}. `}{p.name}{p.id === me ? " (you)" : ""}</span><span>{p.correct} right · <b>{p.points}</b></span></li>)}</ol>;

  return <div className="wh-card wh-live">
    <div className="wh-live-head"><h2><Users size={18} /> {room.title}</h2><button className="wh-back-btn" onClick={leave}>Leave</button></div>
    {room.state === "lobby" && <>
      <p>Share this code with your friend. They open the game, tap <b>Live Challenge → Join with a code</b>, and type it.</p>
      <div className="wh-live-code">{room.code}</div>
      <p><b>Players ({lobbyPlayers.length})</b></p>
      <ul className="wh-live-players">{lobbyPlayers.map((p) => <li key={p.id}>{p.name}{p.id === room.host ? " · host" : ""}{p.id === me ? " (you)" : ""}</li>)}</ul>
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
      {room.state === "question" && <p className="wh-live-waiting">{mine ? "Answer locked in. " : ""}{room.players.map((p) => <span key={p.id} className={answeredIds.has(p.id) ? "done" : hereIds.has(p.id) || p.id === me ? "" : "away"}>{answeredIds.has(p.id) ? "✓" : hereIds.has(p.id) || p.id === me ? "…" : "✕"} {p.name}</span>)}</p>}
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
    {hostGone && <p className="wh-import-error">The host has left. You can leave this challenge.</p>}
    {error && <p className="wh-import-error">{error}</p>}
  </div>;
}
