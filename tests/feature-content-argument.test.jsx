// @vitest-environment jsdom
// MT-02 step 3: the features read the game's copy of the content through the gameContent() they are given (the
// shell passes the content module's). Nothing here calls setGameContent, so the content module's own copy stays
// empty: every result can only come from the given copy. The AI calls are mocked; made-up content.
// Docs: docs/modules/content/content-catalog.md.
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameContent as keptCopy } from "../src/features/content";
import { buildCatalog } from "../src/engine/catalog";
import { liveQuestions } from "../src/features/live/liveEngine";

const generateStory = vi.fn(), generateContent = vi.fn();
vi.mock("../src/engine/ai", async (original) => ({ ...(await original()), generateStory: (...a) => generateStory(...a), generateContent: (...a) => generateContent(...a) }));
const { StoryBuilder, useAiGeneration, useStoryGeneration } = await import("../src/features/ai-helpers");

const W = (word, category) => ({ word, type: "vocab", category, meaning: `Quick and cold, kind ${word.length}${word[0]} of weather.`, situation: `We met the ${word.length} today.`, gap: `We met the ______ today (${word.length}).` });
const copy = buildCatalog([W("Gust", "Weather"), W("Drizzle", "Weather"), W("Hail", "Weather"), W("Mist", "Weather"), W("Fog", "Weather"), W("Ferry", "Travel"), W("Harbour", "Travel")], [], [], ["Weather", "Travel", "Empty"]);
const gameContent = () => copy;
const names = copy.words.map((w) => w.word);

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; generateStory.mockReset(); generateContent.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = (el) => act(async () => root.render(el));
const run = (fn) => act(async () => { await fn(); });

it("the content module's own copy stays empty in this file", () => {
  expect(keptCopy().words).toEqual([]);
});

describe("Live questions", () => {
  it("each question type builds its options from the given copy", () => {
    for (const kind of ["meaning", "gap", "whoami"]) {
      const qs = liveQuestions(copy.words.slice(0, 3), 3, { content: copy, kinds: [kind] });
      expect(qs.length, kind).toBeGreaterThan(0);
      for (const q of qs) expect(q.options.every((o) => names.includes(o) || copy.words.some((w) => w.meaning === o)), kind).toBe(true);
    }
  });
});

describe("story generation", () => {
  let api;
  function Probe() {
    const [stories, setStories] = useState([]);
    api = useStoryGeneration({ stories, setStories, mastery: {}, confusions: {}, viewKey: "v", gameContent });
    return <StoryBuilder story={api} isAdmin gameContent={gameContent} />;
  }
  it("the builder lists the given copy's categories that have words; the AI gets the given words", async () => {
    await render(<Probe />);
    expect([...host.querySelectorAll("label.wh-category-choice")].map((l) => l.textContent)).toEqual(["Weather5", "Travel2"]);
    generateStory.mockResolvedValue({ title: "T", text: "x", targetWords: [], questions: [] });
    await run(() => api.toggleCategory("Weather"));
    await run(() => api.generate());
    const [words, targets] = generateStory.mock.calls[0];
    expect(words).toBe(copy.words);
    expect(targets.every((t) => copy.words.includes(t))).toBe(true);
  });
});

describe("pool generation", () => {
  let api, state;
  function Probe() {
    const [pools, setPools] = useState({});
    const poolsRef = useRef(pools);
    state = { pools };
    api = useAiGeneration({ gameContent, liveContent: () => ({ words: copy.words, grammar: [], combos: [], challenges: [], stories: [] }), poolsRef, setPools, seenSentences: () => ({}) });
    return null;
  }
  it("the AI gets the given words, and its sentence lands in the given word's pool", async () => {
    await render(<Probe />);
    generateContent.mockResolvedValue([{ word: "Ferry", poolType: "gap", text: "The ______ left at noon." }]);
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(generateContent.mock.calls[0][0]).toBe(copy.words);
    expect(state.pools.Ferry.gap.map((x) => x.text)).toContain("The ______ left at noon.");
  });
});
