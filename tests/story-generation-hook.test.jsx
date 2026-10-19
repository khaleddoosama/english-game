// @vitest-environment jsdom
// The story-generation hook and builder (src/features/ai-helpers): asking for a story, stale answers dropped (a newer
// request, a category change, leaving the page), errors, and Add / Regenerate / Discard. Real React state; the AI call
// is mocked; made-up content. The choice of targets: story-rules.test.js. Docs: docs/modules/ai-media/story-generation.md.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameContent, setGameContent } from "../src/features/content";

const generateStory = vi.fn();
const cancelAiTasks = vi.fn();
vi.mock("../src/engine/ai", async (original) => ({ ...(await original()), generateStory: (...a) => generateStory(...a) }));
vi.mock("../src/lib/aiOperations", async (original) => ({ ...(await original()), cancelAiTasks: (...a) => cancelAiTasks(...a) }));
const { StoryBuilder, useStoryGeneration } = await import("../src/features/ai-helpers");

const vocab = (category, n) => Array.from({ length: n }, (_, i) => ({ word: `${category}${i}`, type: "vocab", category, meaning: `Meaning ${i}.`, situation: `A ${category}${i} here.`, gap: "A ______ here." }));
const WORDS_IN = [...vocab("Weather", 3), ...vocab("Hotel", 3), ...vocab("Food", 1)];
const story = (title = "The Long Night") => ({ id: `story-${title}`, title, text: "Once…", targetWords: ["Weather0", "Hotel1"], questions: [{}, {}], sourceCategories: ["Weather", "Hotel"] });
const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

let root, host, api, state, isAdmin, viewKey;
function Probe() {
  const [stories, setStories] = useState([]);
  state = { stories };
  api = useStoryGeneration({ stories, setStories, mastery: {}, confusions: {}, viewKey, gameContent });
  return <StoryBuilder story={api} isAdmin={isAdmin} gameContent={gameContent} />;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isAdmin = true; viewKey = "levels /stories";
  generateStory.mockReset(); cancelAiTasks.mockReset();
  setGameContent(WORDS_IN, [], [], ["Weather", "Hotel", "Food"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const run = (fn) => act(async () => { await fn(); });
const pick = async (...names) => { for (const n of names) await run(() => api.toggleCategory(n)); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("the builder", () => {
  it("shows the categories that have words, with counts, to the admin only", async () => {
    expect([...host.querySelectorAll("label.wh-category-choice")].map((l) => l.textContent)).toEqual(["Weather3", "Hotel3", "Food1"]);
    isAdmin = false;
    await act(async () => root.render(<Probe />));
    expect(host.querySelector(".wh-story-builder")).toBeNull();
  });
  it("no category: a message, and no AI call", async () => {
    await run(() => api.generate());
    expect(api.error).toBe("Choose at least one category first.");
    expect(generateStory).not.toHaveBeenCalled();
  });
  it("too few vocab words: the rule's message, no AI call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await pick("Weather");
    await run(() => api.generate());
    expect(api.error).toBe("The selected categories need at least five vocab words in total.");
    expect(api.state).toBe("error");
    expect(generateStory).not.toHaveBeenCalled();
  });
});

describe("asking for a story", () => {
  it("sends the targets, the categories and the rules; the preview shows the story", async () => {
    generateStory.mockResolvedValue(story());
    await pick("Weather", "Hotel");
    await run(() => api.generate());
    const [words, targets, categories, rules] = generateStory.mock.calls[0];
    expect(words).toBe(gameContent().words);
    expect(targets.length).toBe(5);
    expect(categories).toEqual(["Weather", "Hotel"]);
    expect(rules).toEqual([]);
    expect(cancelAiTasks).toHaveBeenCalledWith(["Write a story"]);
    expect(host.querySelector(".wh-regen-preview").textContent).toContain("The Long Night");
  });
  it("while it is written: the loading line, no Generate button", async () => {
    const pending = later();
    generateStory.mockReturnValueOnce(pending.promise);
    await pick("Weather", "Hotel");
    await act(async () => { api.generate(); });
    expect(host.textContent).toContain("Writing and checking a new story…");
    expect(button("Generate from")).toBeUndefined();
    await run(async () => { pending.resolve(story()); });
  });
  it("an error is shown under the builder, with a default message when it has none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateStory.mockRejectedValueOnce(new Error(""));
    await pick("Weather", "Hotel");
    await run(() => api.generate());
    expect(host.querySelector(".wh-regen-status.error").textContent).toBe("Story generation failed.");
  });
});

describe("stale answers", () => {
  it("the story for an older request is dropped", async () => {
    const first = later(), second = later();
    generateStory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await pick("Weather", "Hotel");
    await act(async () => { api.generate(); });
    await act(async () => { api.generate(); });
    await run(async () => { second.resolve(story("Second")); });
    await run(async () => { first.resolve(story("First")); });
    expect(api.state.title).toBe("Second");
  });
  it("a category change cancels the story, drops its answer and clears the preview and the error", async () => {
    const pending = later();
    generateStory.mockReturnValueOnce(pending.promise);
    await pick("Weather", "Hotel");
    await act(async () => { api.generate(); });
    cancelAiTasks.mockClear();
    await pick("Food");
    expect(cancelAiTasks).toHaveBeenCalledWith(["Write a story"]);
    expect(api.state).toBeNull();
    await run(async () => { pending.resolve(story()); });
    expect(api.state).toBeNull();
    expect(api.categories).toEqual(["Weather", "Hotel", "Food"]);
  });
  it("leaving the page drops a story still loading; a finished preview stays", async () => {
    const pending = later();
    generateStory.mockReturnValueOnce(pending.promise);
    await pick("Weather", "Hotel");
    await act(async () => { api.generate(); });
    viewKey = "levels /";
    await act(async () => root.render(<Probe />));
    expect(api.state).toBeNull();
    await run(async () => { pending.resolve(story()); });
    expect(api.state).toBeNull();
    generateStory.mockResolvedValueOnce(story());
    await run(() => api.generate());
    viewKey = "levels /stories";
    await act(async () => root.render(<Probe />));
    expect(api.state.title).toBe("The Long Night");
  });
});

describe("the preview's buttons", () => {
  beforeEach(async () => { generateStory.mockResolvedValue(story()); await pick("Weather", "Hotel"); await run(() => api.generate()); });
  it("Add to My Stories appends the story and closes the preview", async () => {
    await run(() => button("Add to My Stories").click());
    expect(state.stories.map((s) => s.title)).toEqual(["The Long Night"]);
    expect(host.querySelector(".wh-regen-preview")).toBeNull();
  });
  it("Discard closes it and adds nothing", async () => {
    await run(() => button("Discard").click());
    expect(state.stories).toEqual([]);
    expect(api.state).toBeNull();
  });
  it("Regenerate asks again with the same categories", async () => {
    generateStory.mockResolvedValueOnce(story("Again"));
    await run(() => button("Regenerate").click());
    expect(generateStory).toHaveBeenCalledTimes(2);
    expect(generateStory.mock.calls[1][2]).toEqual(["Weather", "Hotel"]);
    expect(api.state.title).toBe("Again");
  });
});
