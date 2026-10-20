// @vitest-environment jsdom
// Starting rounds (src/features/practice/usePractice.js), wired to the real useProgress and engine as the shell wires
// them: a lesson (and a player limited to their library), a course level, the message after a strong round, new gap
// sentences for used-up words, a personal view (not ready, empty, failing), a story, and the Speed Round (locked,
// nothing to ask, timed from Settings). Each opens the round. Made-up words. Docs: docs/modules/practice/starting-rounds.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V2 } from "../src/engine/v2";
import { buildCatalog } from "../src/engine/catalog";
import { useProgress } from "../src/features/progress";
import { usePractice } from "../src/features/practice";
import { itemsScope } from "../src/features/home/homeState";

const W = (word, category, extra = {}) => ({ word, type: "vocab", category, meaning: `The meaning of ${word}.`, situation: `We talked about the ${word} today.`, gap: `We talked about the ______ today.`, ...extra });
const WORDS = [...["Drizzle", "Gust", "Breeze", "Thunder", "Hail"].map((w) => W(w, "Weather", { level: "A1.2" })), ...["Lobby", "Suite", "Porter"].map((w) => W(w, "Hotel", { level: "A1.3" }))];
const CONTENT = buildCatalog(WORDS, [], [], ["Weather", "Hotel"]);
const STORY = { id: "story-rain", title: "A Rainy Walk", sourceCategories: ["Weather"], targetWords: ["Drizzle", "Gust"], questions: [{ mode: "mcq", targetWord: "Drizzle", prompt: "What fell first?", explanation: "A drizzle." }] };
const known = { stage: "Familiar", total: 3, correct: 2, introducedAt: 1 };

let out, practice, root, host, calls, config;
function Probe() {
  out = useProgress({ repo: { saveProgress: async () => {} }, loaded: true, gameContent: () => CONTENT });
  practice = usePractice({
    progress: out, gameContent: () => CONTENT, liveContent: () => ({ ...CONTENT, stories: [STORY], combos: [] }), quarantine: new Set(),
    home: config.home, views: config.views, itemsScope, imageOk: () => true,
    onLesson: (i) => calls.lesson.push(i), onToast: (t) => calls.toasts.push(t.text), triggerGeneration: (...a) => calls.generate.push(a), onOpen: (s) => calls.opened.push(s.id),
  });
  return null;
}
const run = (fn) => act(async () => fn());
async function start(progress = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  await run(() => out.startFrom({ settings: { questionsPerRound: 6, newWordsPerRound: 2, speedSeconds: 45 }, ...progress }, {}));
}
const targets = () => [...new Set(out.activeSession.queue.flatMap((q) => q.targets || []))];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls = { lesson: [], toasts: [], generate: [], opened: [] };
  config = { home: { limited: false, levels: [] }, views: { ready: true, scopeOf: async () => ({ words: new Set(["Lobby"]), rules: new Set() }), isEmpty: (s) => !s.words.size } };
});
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; vi.restoreAllMocks(); });

describe("lessons and levels", () => {
  it("a lesson: its words, the lesson remembered, the round opened", async () => {
    await start();
    await run(() => practice.startLevel(0));
    expect([out.activeSession.kind, out.activeSession.title, calls.lesson, calls.opened]).toEqual(["practice", "Weather", [0], [out.activeSession.id]]);
    expect(targets().every((w) => CONTENT.levels[0].items.some((i) => i.obj.word === w))).toBe(true);
    expect(out.activeSession.introductions).toHaveLength(2);
  });

  it("a player who sees only their library plays the lesson's items they have; no lesson remembered", async () => {
    config.home = { limited: true, levels: [{ id: CONTENT.levels[0].id, items: CONTENT.levels[0].items.filter((i) => i.obj.word === "Gust") }] };
    await start();
    await run(() => practice.startLevel(0));
    expect([out.activeSession.title, calls.lesson, targets()]).toEqual(["Weather", [null], ["Gust"]]);
  });

  it("no such lesson: nothing", async () => {
    await start();
    await run(() => practice.startLevel(9));
    expect([out.activeSession, calls.opened]).toEqual([null, []]);
  });

  it("a course level: its words; no lesson remembered", async () => {
    await start();
    await run(() => practice.startCourseLevel({ id: "A1.3" }));
    expect([out.activeSession.title, calls.lesson]).toEqual(["A1.3", [null]]);
    expect(targets().every((w) => ["Lobby", "Suite", "Porter"].includes(w))).toBe(true);
  });

  it("after a strong round here: more new words, and the message", async () => {
    await start({ sessionLogs: [{ id: "old", kind: "practice", title: "Weather", correct: 10, total: 10, at: 1 }] });
    await run(() => practice.startLevel(0));
    expect(out.activeSession.introductions).toHaveLength(4);
    expect(calls.toasts).toEqual(["Strong last round here — 4 new words this time."]);
  });

  it("known words whose gap sentences were all read get new ones asked for", async () => {
    await start({ mastery: { Drizzle: known, Gust: known }, seenSentences: { [V2.norm("We talked about the ______ today.")]: Date.now() } });
    await run(() => practice.startLevel(0));
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0][0]).toEqual([{ word: "Drizzle", poolType: "gap" }, { word: "Gust", poolType: "gap" }]);
  });
});

describe("a personal view", () => {
  it("its words; nothing while the library is not ready; a message when empty or failing", async () => {
    await start();
    await run(() => practice.startViewPractice("v1", true, "Travel"));
    expect([out.activeSession.title, targets(), calls.lesson]).toEqual(["Travel", ["Lobby"], [null]]);
    config.views = { ...config.views, scopeOf: async () => ({ words: new Set(), rules: new Set() }) };
    await act(async () => root.render(<Probe />));
    await run(() => practice.startViewPractice("v2"));
    expect(calls.toasts).toEqual(["This view is empty. Add some words first."]);
    config.views = { ...config.views, scopeOf: async () => { throw new Error("Could not open the view."); } };
    await act(async () => root.render(<Probe />));
    await run(() => practice.startViewPractice("v3"));
    expect(calls.toasts.at(-1)).toBe("Could not open the view.");
    config.views = { ...config.views, ready: false, scopeOf: async () => ({ words: new Set(["Lobby"]), rules: new Set() }) };
    await act(async () => root.render(<Probe />));
    calls.opened = [];
    await run(() => practice.startViewPractice("v1"));
    expect(calls.opened).toEqual([]);
  });
});

describe("stories and the Speed Round", () => {
  it("a story starts its round; a broken one shows why", async () => {
    await start();
    await run(() => practice.launchStory(STORY));
    expect([out.activeSession.kind, out.activeSession.sourceStoryId, calls.opened.length]).toEqual(["story", "story-rain", 1]);
    await run(() => practice.launchStory({ id: "broken" }));
    expect(calls.toasts).toHaveLength(1);
    expect(calls.opened).toHaveLength(1);
  });

  it("locked under 5 mastered words; then a timed round from Settings; a message when nothing can be asked", async () => {
    await start();
    const words = CONTENT.words.slice(0, 5);
    await run(() => practice.startSpeedRound(words.slice(0, 4)));
    expect(out.activeSession).toBe(null);
    const before = Date.now();
    await run(() => practice.startSpeedRound(words));
    expect([out.activeSession.kind, out.activeSession.seconds, out.activeSession.title]).toEqual(["speed", 45, "Speed Round"]);
    expect(out.activeSession.deadline - before).toBeGreaterThanOrEqual(45000);
    expect(out.activeSession.deadline - Date.now()).toBeLessThanOrEqual(45000);
    expect(out.activeSession.queue.every((q) => words.some((w) => w.word === q.answers[0]))).toBe(true);
    // no meaning and no gap sentence: no question can be asked
    const lonely = ["A1", "B2", "C3", "D4", "E5"].map((w) => W(w, "X", { meaning: "", gap: "" }));
    await run(() => practice.startSpeedRound(lonely));
    expect(calls.toasts.at(-1)).toBe("No short questions with safe options are available.");
  });

  it("an unknown saved Speed Round time becomes the default (60 s)", async () => {
    await start({ settings: { speedSeconds: 0 } });
    await run(() => practice.startSpeedRound(CONTENT.words.slice(0, 5)));
    expect(out.activeSession.seconds).toBe(60);
  });
});
