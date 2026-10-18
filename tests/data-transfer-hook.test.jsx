// @vitest-environment jsdom
// The import & export hook (src/features/data): what applying a checked file does to the shell's state in each mode,
// what is refused, the files it makes, and the Profile page's backups (download, copy). Real React state; made-up
// content. The steps with no state: import-plan.test.js, import-export.test.js. Docs: docs/modules/admin/import-export.md.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVEL_ORDER, mergeCustomData } from "../src/engine/data";

const aiFixImportJson = vi.fn();
vi.mock("../src/engine/ai", async (original) => ({ ...(await original()), aiFixImportJson: (...a) => aiFixImportJson(...a) }));
const { useDataTransfer } = await import("../src/features/data");

const word = (w, category, extra = {}) => ({
  word: w, type: "vocab", category, meaning: `The meaning of ${w}.`, partsOfSpeech: ["noun"],
  situation: `We talked about the ${w} on the way home.`, gap: "We talked about the ______ on the way home.", ...extra,
});
const contentFile = (words, extra = {}) => JSON.stringify({ schemaVersion: 2, kind: "content", words, ...extra });
const backupFile = (words, extra = {}) => JSON.stringify({ schemaVersion: 6, contentSchemaVersion: 2, kind: "backup", words, levelOrder: [...new Set(words.map((w) => w.category))], score: 30, mastery: { [words[0].word]: { total: 2, correct: 1 } }, ...extra });

let root, host, api, state, isAdmin, contentNoteRef, migrateRenamedProgress, applyRestoredProgress, backupPayload, calls, resetProgress, wipeContent;
const startWords = () => [word("Ferry", "Travel"), word("Harbour", "Travel")];

function Probe() {
  const [lists, setLists] = useState({ words: startWords(), grammar: [], challenges: [], combos: [], stories: [] });
  const [dataVersion, setDataVersion] = useState(0);
  const [freshCopy, setShowFreshCopyPrompt] = useState(true);
  const [toast, setToast] = useState(null);
  const [copied, setQuickBackupCopied] = useState(false);
  state = { lists, dataVersion, freshCopy, toast, copied };
  api = useDataTransfer({
    isAdmin, exportedBy: "tester", liveContent: () => ({ ...lists, note: contentNoteRef.current }), backupPayload, contentNoteRef,
    setContent: (c) => setLists({ words: c.words, grammar: c.grammar, challenges: c.challenges, combos: c.combos, stories: c.stories }),
    migrateRenamedProgress, applyRestoredProgress, resetProgress, wipeContent, set: { setDataVersion, setShowFreshCopyPrompt, setToast, setQuickBackupCopied },
  });
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isAdmin = true;
  contentNoteRef = { current: "old note" };
  migrateRenamedProgress = vi.fn();
  applyRestoredProgress = vi.fn();
  backupPayload = vi.fn(() => ({ kind: "backup", score: 30 }));
  aiFixImportJson.mockReset();
  calls = [];
  resetProgress = vi.fn(async () => { calls.push("reset"); });
  wipeContent = vi.fn(async () => { calls.push("wipe"); });
  mergeCustomData(startWords(), [], [], ["Travel"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const apply = async (text, mode) => { let out; await act(async () => { out = api.applyImport(api.checkImport(text), mode); }); return out; };
const words = () => state.lists.words.map((w) => `${w.word}:${w.category}`).sort();

describe("applying a file", () => {
  it("content: merged into the live content, the level order grows, and the player is told", async () => {
    const text = await apply(contentFile([word("Lantern", "Camping")]), "content");
    expect(words()).toEqual(["Ferry:Travel", "Harbour:Travel", "Lantern:Camping"]);
    expect([...LEVEL_ORDER]).toEqual(["Travel", "Camping"]);
    expect(text).toBe("Content imported; everyone's progress is kept");
    expect(state.toast).toEqual({ kind: "import", text });
    expect(state.dataVersion).toBe(1);
    expect(state.freshCopy).toBe(false);
    expect(applyRestoredProgress).not.toHaveBeenCalled();
  });
  it("content: the file's note replaces the content note; a file without one keeps it", async () => {
    await apply(contentFile([word("Lantern", "Camping")]), "content");
    expect(contentNoteRef.current).toBe("old note");
    await apply(contentFile([word("Compass", "Camping")], { note: "new note" }), "content");
    expect(contentNoteRef.current).toBe("new note");
  });
  it("content: a v3 rename is handed on so progress follows it", async () => {
    const v3 = (name) => JSON.stringify({ schemaVersion: 3, kind: "content", categories: [{ id: "trips", title: "Trips" }],
      words: [{ id: "tent", word: name, type: "vocab", category: "trips", partsOfSpeech: ["noun"], meaning: "A shelter made of cloth.", situations: [`We slept in a ${name} by the lake.`], gaps: ["We slept in a ______ by the lake."] }] });
    await apply(v3("Tent"), "content");
    await apply(v3("Tepee"), "content");
    expect(words()).toContain("Tepee:Trips");
    expect(migrateRenamedProgress).toHaveBeenLastCalledWith({ words: [{ from: "Tent", to: "Tepee" }], categories: [] });
  });
  it("full: the content and the level order come from the backup alone, and the progress is replaced", async () => {
    const text = await apply(backupFile([word("Lantern", "Camping")]), "full");
    expect(words()).toEqual(["Lantern:Camping"]);
    expect([...LEVEL_ORDER]).toEqual(["Camping"]);
    expect(applyRestoredProgress).toHaveBeenCalledTimes(1);
    expect(applyRestoredProgress.mock.calls[0][0]).toMatchObject({ score: 30, mastery: { Lantern: { total: 2, correct: 1 } } });
    expect(migrateRenamedProgress).not.toHaveBeenCalled();
    expect(text).toBe("Backup restored: content and progress");
    expect(state.dataVersion).toBe(1);
  });
  it("progress: only the progress is replaced; the content stays as it is", async () => {
    const text = await apply(backupFile([word("Lantern", "Camping")]), "progress");
    expect(words()).toEqual(["Ferry:Travel", "Harbour:Travel"]);
    expect([...LEVEL_ORDER]).toEqual(["Travel"]);
    expect(applyRestoredProgress.mock.calls[0][0]).toMatchObject({ score: 30 });
    expect(text).toBe("Your progress was restored");
  });
  it("a player cannot import content: refused, and nothing changes", async () => {
    isAdmin = false;
    await act(async () => root.render(<Probe />));
    const check = api.checkImport(contentFile([word("Lantern", "Camping")]));
    expect(() => api.applyImport(check, "content")).toThrow();
    expect(() => api.applyImport(check, "progress")).toThrow();
    expect(words()).toEqual(["Ferry:Travel", "Harbour:Travel"]);
    expect(state.dataVersion).toBe(0);
    expect(state.toast).toBeNull();
    expect(applyRestoredProgress).not.toHaveBeenCalled();
  });
  it("a player can restore their own progress from a backup", async () => {
    isAdmin = false;
    await act(async () => root.render(<Probe />));
    expect(await apply(backupFile([word("Lantern", "Camping")]), "progress")).toBe("Your progress was restored");
    expect(applyRestoredProgress).toHaveBeenCalledTimes(1);
  });
});

describe("checking a file", () => {
  it("is checked against the live content", () => {
    const check = api.checkImport(contentFile([word("Ferry", "Travel"), word("Lantern", "Camping")]));
    expect(check.words).toMatchObject({ added: 1, unchanged: 1 });
  });
  it("a file that is not JSON is refused", () => {
    expect(() => api.checkImport("not json")).toThrow();
  });
});

describe("files and backups", () => {
  it("a backup file holds the shell's backup and who made it", () => {
    const file = api.exportFile("backup");
    expect(backupPayload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(file.text)).toMatchObject({ kind: "backup", score: 30, exportedBy: "tester" });
  });
  it("a content file holds the live words and does not build a backup", () => {
    const file = api.exportFile("content");
    expect(JSON.parse(file.text).words.map((w) => w.word)).toEqual(["Ferry", "Harbour"]);
    expect(backupPayload).not.toHaveBeenCalled();
  });
  it("Download backup saves the backup file", () => {
    URL.createObjectURL = vi.fn(() => "blob:backup"); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { click.saved = { href: this.href, name: this.download }; });
    api.downloadBackup();
    expect(click.saved).toEqual({ href: "blob:backup", name: api.exportFile("backup").name });
  });
  it("Copy backup puts the backup on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await act(async () => { await api.handleQuickBackup(); });
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({ kind: "backup", exportedBy: "tester" });
    expect(state.copied).toBe(true);
    expect(state.toast).toEqual({ kind: "import", text: "Full backup copied. Paste it into Import & export to restore it." });
  });
  it("when the clipboard is refused, the player is told to use Download", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await api.handleQuickBackup(); });
    expect(state.copied).toBe(false);
    expect(state.toast).toEqual({ text: "Couldn't copy to the clipboard. Use Download backup instead." });
  });
});

describe("Delete everything", () => {
  it("resets the progress first, then empties the content and the level order, and clears the saved content", async () => {
    await act(async () => { await api.wipeEverything(); });
    expect(calls).toEqual(["reset", "wipe"]);
    expect(state.lists).toEqual({ words: [], grammar: [], challenges: [], combos: [], stories: [] });
    expect([...LEVEL_ORDER]).toEqual([]);
    expect(state.dataVersion).toBe(1);
  });
  it("a failed server wipe is only logged; the content on screen is empty anyway", async () => {
    wipeContent.mockRejectedValue(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await api.wipeEverything(); });
    expect(log).toHaveBeenCalledWith("Could not clear content:", expect.any(Error));
    expect(state.lists.words).toEqual([]);
    expect(state.dataVersion).toBe(1);
  });
});

describe("AI repair", () => {
  it("sends the problems, and returns the repaired file as text with what changed", async () => {
    aiFixImportJson.mockResolvedValue({ fixed: { kind: "content", words: [] }, changes: [] });
    const out = await api.aiFixImport("{bad", ["words[0].gap: needs one ______", "words[1].type: unsupported type"]);
    expect(aiFixImportJson).toHaveBeenCalledWith("{bad", "words[0].gap: needs one ______\nwords[1].type: unsupported type");
    expect(out).toEqual({ text: JSON.stringify({ kind: "content", words: [] }, null, 2), changes: ["AI adjusted the file to pass the checks."] });
  });
});
