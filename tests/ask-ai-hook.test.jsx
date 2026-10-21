// @vitest-environment jsdom
// The Ask AI hook and drawer (src/features/ai-helpers): opening and asking, stale answers dropped, closing cancels,
// adding a word (admin only, refusals), and the pronunciation term. Real React state; the AI call is mocked; made-up
// content. The steps with no state: ask-ai-rules.test.js. Docs: docs/modules/ai-media/ask-ai.md.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameContent, setGameContent } from "../src/features/content";

const askAiForWord = vi.fn();
const cancelAiTasks = vi.fn();
vi.mock("../src/lib/aiPrompts", async (original) => ({ ...(await original()), askAiForWord: (...a) => askAiForWord(...a) }));
vi.mock("../src/lib/aiOperations", async (original) => ({ ...(await original()), cancelAiTasks: (...a) => cancelAiTasks(...a) }));
const { AskAiDrawer, useAskAi } = await import("../src/features/ai-helpers");

const ferry = { word: "Ferry", type: "vocab", category: "Travel", partsOfSpeech: ["noun"], meaning: "A boat that carries people.", situation: "We took the Ferry to the island.", gap: "We took the ______ to the island." };
const answer = (extra = {}) => ({ word: "Lantern", type: "vocab", partsOfSpeech: ["noun"], category: "Camping", meaning: "A light you can carry.", situation: "We lit the Lantern at night.", gap: "We lit the ______ at night.", hints: ["It gives light."], pronunciation: "LAN-tern", ...extra });
const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

let root, host, ask, state, isAdmin, contextCategory, onWordAdded;
function Probe() {
  const [customWords, setCustomWords] = useState([ferry]);
  const [dataVersion, setDataVersion] = useState(0);
  const [toast, setToast] = useState(null);
  state = { customWords, dataVersion, toast };
  ask = useAskAi({
    isAdmin, gameContent, setGameContent, liveContent: () => ({ words: customWords, grammar: [], challenges: [], combos: [], stories: [] }),
    content: { customWords, customGrammar: [], customChallenges: [] }, set: { setCustomWords, setDataVersion, setToast }, contextCategory, onWordAdded,
  });
  return <AskAiDrawer ask={ask} isAdmin={isAdmin} />;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isAdmin = true; contextCategory = null; onWordAdded = vi.fn();
  askAiForWord.mockReset(); cancelAiTasks.mockReset();
  setGameContent([ferry], [], [], ["Travel"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const drawer = () => host.querySelector('[role="dialog"][aria-label="Ask AI about a word"]');
const run = (fn) => act(async () => { await fn(); });

describe("opening and asking", () => {
  it("opens with the cleaned term and asks at once, sending the game's own entry when it has one", async () => {
    askAiForWord.mockResolvedValue(answer({ word: "Ferry" }));
    await run(() => ask.openAskAi("  ferry  "));
    expect(drawer()).not.toBeNull();
    expect(ask.term).toBe("ferry");
    expect(askAiForWord).toHaveBeenCalledWith("ferry", gameContent().words.find((w) => w.word === "Ferry"));
    expect(cancelAiTasks).toHaveBeenCalledWith(["Ask AI about a word"]);
    expect(ask.result.alreadyInCollection).toBe(true);
    expect(drawer().textContent).toContain("Already in your collection");
    expect(ask.busy).toBe(false);
  });
  it("opening with no term only opens the drawer", async () => {
    await run(() => ask.openAskAi(""));
    expect(drawer()).not.toBeNull();
    expect(askAiForWord).not.toHaveBeenCalled();
  });
  it("a new word is not in the collection; the admin sees Add to Collection", async () => {
    askAiForWord.mockResolvedValue(answer());
    await run(() => ask.openAskAi("lantern"));
    expect(ask.result.alreadyInCollection).toBe(false);
    expect(drawer().textContent).toContain("Add to Collection");
  });
  it("an error is shown, with a default message when it has none", async () => {
    askAiForWord.mockRejectedValueOnce(new Error("AI features need the online version."));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await run(() => ask.openAskAi("lantern"));
    expect(drawer().textContent).toContain("AI features need the online version.");
    askAiForWord.mockRejectedValueOnce(new Error(""));
    await run(() => ask.runAskAi("lantern"));
    expect(ask.error).toBe("AI explanation is unavailable. Try again.");
  });
});

describe("stale answers and closing", () => {
  it("the answer to an older question is dropped", async () => {
    const first = later(), second = later();
    askAiForWord.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () => { ask.openAskAi("lantern"); });
    await act(async () => { ask.runAskAi("torch"); });
    await run(async () => { second.resolve(answer({ word: "Torch" })); });
    await run(async () => { first.resolve(answer()); });
    expect(ask.result.word).toBe("Torch");
  });
  it("closing cancels the question; an answer after that is dropped and the drawer is not busy", async () => {
    const pending = later();
    askAiForWord.mockReturnValueOnce(pending.promise);
    await act(async () => { ask.openAskAi("lantern"); });
    expect(ask.busy).toBe(true);
    cancelAiTasks.mockClear();
    await run(() => ask.setOpen(false));
    expect(cancelAiTasks).toHaveBeenCalledWith(["Ask AI about a word"]);
    expect(ask.busy).toBe(false);
    await run(async () => { pending.resolve(answer()); });
    expect(ask.result).toBeNull();
  });
  it("Escape closes the drawer", async () => {
    await run(() => ask.openAskAi(""));
    await run(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(drawer()).toBeNull();
  });
});

describe("adding the word", () => {
  const asked = async (extra) => { askAiForWord.mockResolvedValue(answer(extra)); await run(() => ask.openAskAi("lantern")); };
  it("goes into the custom words in the player's category, the content save follows, and the library keeps it", async () => {
    contextCategory = "Hotel";
    await act(async () => root.render(<Probe />));
    await asked();
    await run(() => ask.addAiWord());
    const added = state.customWords.find((w) => w.word === "Lantern");
    expect(added).toMatchObject({ category: "Hotel", _aiAdded: true });
    expect(gameContent().words.some((w) => w.word === "Lantern")).toBe(true);
    expect(state.dataVersion).toBe(1);
    expect(state.toast).toEqual({ kind: "import", text: "Lantern added to your collection" });
    expect(onWordAdded).toHaveBeenCalledWith(added);
    expect(ask.result.alreadyInCollection).toBe(true);
  });
  it("a card with Arabic text is refused with the reason, and nothing is added", async () => {
    await asked({ meaning: "A light (فانوس)." });
    await run(() => ask.addAiWord());
    expect(ask.error).toBe("The generated card contains non-English text. Regenerate it before adding.");
    expect(state.customWords).toHaveLength(1);
    expect(state.dataVersion).toBe(0);
    expect(onWordAdded).not.toHaveBeenCalled();
  });
  it("a card that fails the content checks is refused", async () => {
    await asked({ type: "slang" });
    await run(() => ask.addAiWord());
    expect(ask.error).toBe("Cannot add this card: words[0].type: unsupported type");
    expect(state.customWords).toHaveLength(1);
  });
  it("a player sees no Add button, and cannot add", async () => {
    isAdmin = false;
    await act(async () => root.render(<Probe />));
    await asked();
    expect(drawer().textContent).not.toContain("Add to Collection");
    await run(() => ask.addAiWord());
    expect(state.customWords).toHaveLength(1);
  });
});

describe("pronunciation", () => {
  it("Listen opens the pronunciation window for the answer's word", async () => {
    askAiForWord.mockResolvedValue(answer());
    await run(() => ask.openAskAi("lantern"));
    await run(() => { [...drawer().querySelectorAll("button")].find((b) => b.textContent.includes("Listen")).click(); });
    expect(ask.listenTerm).toBe("Lantern");
  });
});
