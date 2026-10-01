// Live Challenge: rules and the full flow on the local backend (the same
// rules the server applies; supabase/tests/live_challenges.sql covers the
// SQL side).
import { beforeEach, describe, expect, it } from "vitest";
import { FEEDBACK_MS, NETWORK_SLACK_MS, answerSlack, challengeLink, clampAnswerMs, codeFromInput, formatMs, isSettled, judgeAnswer, rankPlayers, splitQuestions, validateQuestions, visibleQuestions } from "../src/features/live/liveRules.js";
import { createLocalLiveApi, withRetry } from "../src/features/live/liveApi.js";

const Q = (answer, extra = {}) => ({ mode: "meaning", prompt: `p-${answer}`, options: ["Apple", "Bread", "Cheese"], answer, word: answer.toLowerCase(), explanation: `about ${answer}`, sentences: [`s-${answer}`], ...extra });
const QS = [Q("Apple"), Q("Bread"), Q("Cheese")];

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

// Several players sharing one "server" (storage) and one fake clock.
function world() {
  const storage = memoryStorage();
  let t = Date.parse("2026-10-01T10:00:00Z");
  const as = (id) => createLocalLiveApi({ storage, me: () => ({ id, name: id }), now: () => t, clock: () => t });
  return { storage, as, tick: (ms) => { t += ms; }, now: () => t };
}

describe("live rules", () => {
  it("reads codes from codes and links", () => {
    expect(codeFromInput("ab12cd")).toBe("AB12CD");
    expect(codeFromInput("https://word-hunter.vercel.app/live/Ab12Cd")).toBe("AB12CD");
    expect(codeFromInput("/live/AB12CD?x=1")).toBe("AB12CD");
    expect(codeFromInput(" AB 12-CD ")).toBe("AB12CD");
    expect(codeFromInput("ABC")).toBeNull();
    expect(codeFromInput("")).toBeNull();
    expect(challengeLink("AB12CD", "https://x.app")).toBe("https://x.app/live/AB12CD");
  });

  it("keeps device times honest", () => {
    expect(clampAnswerMs(1200, 1500)).toBe(1200);             // normal
    expect(clampAnswerMs(999999, 1500)).toBe(1500);           // can't take longer than elapsed
    expect(clampAnswerMs(10, 20000)).toBe(20000 - NETWORK_SLACK_MS); // can't claim to be much faster
    expect(clampAnswerMs(10, 20000, 3300)).toBe(16700);
    expect(clampAnswerMs(-5, 300)).toBe(0);
    expect(clampAnswerMs(undefined, 800)).toBe(800);
  });

  it("allows the network plus the card shown after the previous answer", () => {
    expect(answerSlack(null)).toBe(1500);
    expect(answerSlack({ correct: true })).toBe(1500 + FEEDBACK_MS.correct);
    expect(answerSlack({ correct: false })).toBe(1500 + FEEDBACK_MS.wrong);
    expect(answerSlack({ correct: false }, false)).toBe(1500 + FEEDBACK_MS.correct); // no reveal: the short card
  });

  it("shows no question before Start, then one at a time, then all", () => {
    const qs = ["q0", "q1", "q2"];
    expect(visibleQuestions(qs, "lobby", null)).toBeNull();
    expect(visibleQuestions(qs, "playing", { started_at: null, answered: 0 })).toBeNull();
    expect(visibleQuestions(qs, "playing", { started_at: "x", answered: 0 })).toEqual(["q0"]);
    expect(visibleQuestions(qs, "playing", { started_at: "x", answered: 2 })).toEqual(["q0", "q1", "q2"]);
    expect(visibleQuestions(qs, "done", null)).toEqual(qs);
  });

  it("judges answers, ignoring case and spaces, and enforces the time limit", () => {
    expect(judgeAnswer({ choice: " apple ", answer: "Apple", claimedMs: 500, elapsedMs: 600, seconds: 20 })).toEqual({ choice: "apple", correct: true, ms: 500 });
    expect(judgeAnswer({ choice: "Bread", answer: "Apple", claimedMs: 500, elapsedMs: 600, seconds: 20 }).correct).toBe(false);
    expect(judgeAnswer({ choice: null, answer: "Apple", claimedMs: 500, elapsedMs: 600, seconds: 20 })).toEqual({ choice: null, correct: false, ms: 500 });
    const late = judgeAnswer({ choice: "Apple", answer: "Apple", claimedMs: 25000, elapsedMs: 26000, seconds: 20 });
    expect(late).toEqual({ choice: null, correct: false, ms: 20000 });
    expect(judgeAnswer({ choice: "Apple", answer: "Apple", claimedMs: 90000, elapsedMs: 90000, seconds: 0 }).correct).toBe(true); // no limit
  });

  it("ranks by right answers, then finishing, then total time", () => {
    const players = [
      { user_id: "slow3", correct: 3, total_ms: 9000, started_at: "x", finished_at: "x" },
      { user_id: "fast2", correct: 2, total_ms: 1000, started_at: "x", finished_at: "x" },
      { user_id: "quit2", correct: 2, total_ms: 500, started_at: "x", finished_at: null },
      { user_id: "slow2", correct: 2, total_ms: 4000, started_at: "x", finished_at: "x" },
      { user_id: "never", correct: 0, total_ms: 0, started_at: null, finished_at: null },
    ];
    const ranked = rankPlayers(players);
    expect(ranked.map((p) => `${p.user_id}#${p.rank}`)).toEqual(["slow3#1", "fast2#2", "slow2#3", "quit2#4"]);
  });

  it("gives exact ties the same rank", () => {
    const tie = rankPlayers([
      { user_id: "a", correct: 2, total_ms: 3000, started_at: "x", finished_at: "x" },
      { user_id: "b", correct: 2, total_ms: 3000, started_at: "x", finished_at: "x" },
      { user_id: "c", correct: 1, total_ms: 100, started_at: "x", finished_at: "x" },
    ]);
    expect(tie.map((p) => p.rank)).toEqual([1, 1, 3]);
  });

  it("knows when a challenge is over", () => {
    const base = { state: "playing", start_mode: "together", max_players: 3, expires_at: "2099-01-01T00:00:00Z" };
    expect(isSettled(base, [{ finished_at: "x" }, { finished_at: null }])).toBe(false);
    expect(isSettled(base, [{ finished_at: "x" }, { finished_at: "x" }])).toBe(true);
    expect(isSettled({ ...base, start_mode: "anytime" }, [{ finished_at: "x" }, { finished_at: "x" }])).toBe(false); // room for one more
    expect(isSettled({ ...base, start_mode: "anytime" }, [{ finished_at: "x" }, { finished_at: "x" }, { finished_at: "x" }])).toBe(true);
    expect(isSettled({ ...base, expires_at: "2000-01-01T00:00:00Z" }, [{ finished_at: null }])).toBe(true);
    expect(isSettled({ ...base, state: "lobby" }, [{ finished_at: "x" }])).toBe(false);
  });

  it("validates questions and keeps answers out of what players see", () => {
    expect(validateQuestions(QS)).toBeNull();
    expect(validateQuestions(QS.slice(0, 2))).toMatch(/3 to 50/);
    expect(validateQuestions([...QS.slice(0, 2), { ...Q("Apple"), answer: "Zebra" }])).toMatch(/answer among them/);
    expect(validateQuestions([...QS.slice(0, 2), { ...Q("Apple"), options: ["Apple"] }])).toMatch(/2-8 options/);
    const { questions, key } = splitQuestions(QS);
    expect(JSON.stringify(questions)).not.toMatch(/answer|about Apple|s-Apple/);
    expect(key[0]).toEqual({ answer: "Apple", word: "apple", explanation: "about Apple", sentences: ["s-Apple"] });
  });

  it("formats times", () => {
    expect(formatMs(1234)).toBe("1.2s");
    expect(formatMs(75000)).toBe("1:15");
  });
});

describe("a challenge from link to winner", () => {
  let w;
  beforeEach(() => { w = world(); });

  it("plays a full together challenge with 3 players", async () => {
    const alice = w.as("alice"), bob = w.as("bob"), cara = w.as("cara"), dan = w.as("dan");
    const code = await alice.create({ title: "Food", seconds: 20, maxPlayers: 3, startMode: "together", settings: { reveal: true }, questions: QS });
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // An invite preview shows the rules but not the questions.
    const preview = await bob.view(code.toLowerCase());
    expect(preview.member).toBe(false);
    expect(preview.questions).toBeNull();
    expect(preview.question_count).toBe(3);

    const joined = await bob.join(code);
    expect(joined.member).toBe(true);
    expect(JSON.stringify(joined.questions)).not.toMatch(/"answer"/);
    await bob.join(code); // twice is harmless
    await cara.join(code);
    await expect(dan.join(code)).rejects.toThrow(/full \(3 players\)/);
    await expect(bob.start(code)).rejects.toThrow(/Only the creator/);
    await expect(bob.answer(code, 0, "Apple", 100)).rejects.toThrow(/ended|running/);

    await alice.start(code);
    await expect(dan.join(code)).rejects.toThrow(/already started/);

    // Alice: 3/3, slow. Bob: 2/3. Cara: 2/3, faster than Bob.
    await alice.begin(code);
    w.tick(5000);
    expect((await alice.answer(code, 0, "apple", 5000)).correct).toBe(true);
    await expect(alice.answer(code, 2, "Cheese", 100)).rejects.toThrow(/in order/);
    expect((await alice.answer(code, 0, "Bread", 1)).correct).toBe(true); // a retry returns the first result
    w.tick(5000); await alice.answer(code, 1, "Bread", 5000);
    w.tick(5000);
    const last = await alice.answer(code, 2, "Cheese", 5000);
    expect(last.me.finished_at).not.toBeNull();
    expect(last.done).toBe(false); // others still playing
    await expect(alice.answer(code, 3, "Apple", 1)).rejects.toThrow(/every question/);

    await bob.begin(code);
    w.tick(3000); await bob.answer(code, 0, "Apple", 3000);
    w.tick(3000); await bob.answer(code, 1, "Cheese", 3000);
    w.tick(3000); await bob.answer(code, 2, "Cheese", 3000);

    await cara.begin(code);
    w.tick(1000); await cara.answer(code, 0, "Apple", 1000);
    w.tick(1000); await cara.answer(code, 1, "Apple", 1000);
    w.tick(1000);
    const end = await cara.answer(code, 2, "Cheese", 1000);
    expect(end.done).toBe(true);

    const final = await bob.view(code);
    expect(final.state).toBe("done");
    expect(final.key.map((k) => k.answer)).toEqual(["Apple", "Bread", "Cheese"]);
    const order = [...final.players].sort((a, b) => a.rank - b.rank).map((p) => `${p.user_id}#${p.rank}`);
    expect(order).toEqual(["alice#1", "cara#2", "bob#3"]);
    expect(final.my_answers.map((a) => a.correct)).toEqual([true, false, true]);
    const mine = await bob.mine();
    expect(mine[0]).toMatchObject({ code, state: "done", rank: 3, finished: true });
  });

  it("caps claimed times and counts answers after the limit as wrong", async () => {
    const alice = w.as("alice"), bob = w.as("bob");
    const code = await alice.create({ title: "T", seconds: 10, maxPlayers: 2, startMode: "together", questions: QS });
    await bob.join(code); await alice.start(code); await alice.begin(code);
    w.tick(2000);
    const r1 = await alice.answer(code, 0, "Apple", 1); // claims 1 ms after 2 s: only 1.5 s of slack
    expect(r1.ms).toBe(500);
    w.tick(30000);
    const r2 = await alice.answer(code, 1, "Bread", 100); // claims 0.1 s after 30 s: floored, then over the limit
    expect(r2).toMatchObject({ correct: false, ms: 10000, choice: null });
  });

  it("anytime challenges open at once and end when full and finished", async () => {
    const alice = w.as("alice"), bob = w.as("bob");
    const code = await alice.create({ title: "Any", seconds: 0, maxPlayers: 2, startMode: "anytime", questions: QS, hours: 2 });
    expect((await alice.view(code)).state).toBe("playing");
    await alice.begin(code);
    for (const [i, a] of ["Apple", "Bread", "Cheese"].entries()) { w.tick(1000); await alice.answer(code, i, a, 1000); }
    expect((await alice.view(code)).state).toBe("playing"); // a seat is still free
    await bob.join(code); // joining after others played is fine in anytime mode
    await bob.begin(code);
    for (const [i, a] of ["Apple", "Apple", "Apple"].entries()) { w.tick(500); await bob.answer(code, i, a, 500); }
    const v = await alice.view(code);
    expect(v.state).toBe("done");
    expect(v.players.find((p) => p.user_id === "alice").rank).toBe(1);
  });

  it("anytime challenges end when the link expires", async () => {
    const alice = w.as("alice"), bob = w.as("bob");
    const code = await alice.create({ title: "Exp", seconds: 0, maxPlayers: 5, startMode: "anytime", questions: QS, hours: 1 });
    await alice.begin(code);
    await alice.answer(code, 0, "Apple", 100);
    w.tick(2 * 3600000);
    await expect(bob.join(code)).rejects.toThrow(/ended/);
    const v = await alice.view(code);
    expect(v.state).toBe("done");
    expect(v.players[0]).toMatchObject({ rank: 1, finished_at: null });
  });

  it("lets players leave the waiting room and the creator remove or cancel", async () => {
    const alice = w.as("alice"), bob = w.as("bob"), cara = w.as("cara");
    const code = await alice.create({ title: "L", seconds: 20, maxPlayers: 4, startMode: "together", questions: QS });
    await bob.join(code); await cara.join(code);
    await bob.leave(code);
    expect((await alice.view(code)).players.map((p) => p.user_id)).toEqual(["alice", "cara"]);
    await expect(cara.removePlayer(code, "alice")).rejects.toThrow(/Only the creator/);
    await expect(alice.removePlayer(code, "alice")).rejects.toThrow(/yourself/);
    await alice.removePlayer(code, "cara");
    expect((await alice.view(code)).players).toHaveLength(1);
    await expect(alice.start(code)).rejects.toThrow(/one more player/);
    await alice.leave(code);
    await expect(alice.view(code)).rejects.toThrow(/No challenge/);
  });

  it("lets the creator end early; only players who started get a result", async () => {
    const alice = w.as("alice"), bob = w.as("bob");
    const code = await alice.create({ title: "E", seconds: 20, maxPlayers: 3, startMode: "together", questions: QS });
    await bob.join(code); await alice.start(code);
    await alice.begin(code);
    await alice.answer(code, 0, "Apple", 100);
    await expect(bob.end(code)).rejects.toThrow(/Only the creator/);
    await alice.end(code);
    const v = await bob.view(code);
    expect(v.state).toBe("done");
    expect(v.players.find((p) => p.user_id === "alice").rank).toBe(1);
    expect(v.players.find((p) => p.user_id === "bob").rank).toBeNull();
  });

  it("between friends: no early look at the questions, no answer before Start, the creator marked (review F06)", async () => {
    const alice = w.as("alice"), bob = w.as("bob");
    const code = await alice.create({ title: "Fair", seconds: 20, maxPlayers: 2, startMode: "together", settings: { reveal: true }, questions: QS });
    expect((await bob.join(code)).questions).toBeNull(); // the waiting room shows nothing
    await alice.start(code);
    expect((await bob.view(code)).questions).toBeNull(); // nor before Start
    await expect(bob.answer(code, 0, "Apple", 1)).rejects.toThrow(/Press Start first/);
    const started = await bob.begin(code);
    expect(started.questions.map((q) => q.prompt)).toEqual([QS[0].prompt]);
    w.tick(3000);
    const r = await bob.answer(code, 0, "Bread", 3000);
    expect(r.next.prompt).toBe(QS[1].prompt); // the answer brings the next question
    expect((await bob.view(code)).questions).toHaveLength(2);
    // After a wrong answer the card stays longer, and that's allowed for.
    w.tick(1800 + 1000 + 1200);
    expect((await bob.answer(code, 1, "Bread", 1000)).ms).toBe(1000);
    await alice.begin(code);
    for (const [i, a] of ["Apple", "Bread", "Cheese"].entries()) { w.tick(1000); await alice.answer(code, i, a, 1000); }
    w.tick(1000); await bob.answer(code, 2, "Cheese", 1000);
    const done = await bob.view(code);
    expect(done.questions).toHaveLength(3);
    expect(done.players.find((p) => p.user_id === "alice").rank).toBe(1);
    const stored = JSON.parse(w.storage.getItem(`live3:${code}`));
    expect(stored.results.find((x) => x.user_id === "alice").is_host).toBe(true);
    expect(stored.results.find((x) => x.user_id === "bob").is_host).toBe(false);
  });

  it("rejects bad setups", async () => {
    const alice = w.as("alice");
    await expect(alice.create({ title: "x", maxPlayers: 11, startMode: "together", questions: QS })).rejects.toThrow(/2 to 10/);
    await expect(alice.create({ title: "x", maxPlayers: 1, startMode: "together", questions: QS })).rejects.toThrow(/2 to 10/);
    await expect(alice.create({ title: "x", maxPlayers: 2, startMode: "whenever", questions: QS })).rejects.toThrow(/start mode/);
    await expect(alice.create({ title: "x", maxPlayers: 2, startMode: "together", questions: QS.slice(0, 1) })).rejects.toThrow(/3 to 50/);
    await expect(alice.view("ZZZZZZ")).rejects.toThrow(/No challenge/);
  });
});

describe("answer retries", () => {
  it("retries dropped connections but not real refusals", async () => {
    let calls = 0;
    const flaky = async () => { calls += 1; if (calls < 2) throw Object.assign(new Error("offline"), { code: "offline" }); return "ok"; };
    expect(await withRetry(flaky)).toBe("ok");
    expect(calls).toBe(2);
    let refused = 0;
    const no = async () => { refused += 1; throw Object.assign(new Error("Answer the questions in order."), { code: "22023" }); };
    await expect(withRetry(no)).rejects.toThrow(/in order/);
    expect(refused).toBe(1);
  });
});
