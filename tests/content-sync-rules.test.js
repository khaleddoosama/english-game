// Loading and saving the content, the steps with no state (src/features/content/contentSyncRules.js): what one save
// sends, the warning after a failed save, and the embedded pictures. Made-up content. Docs:
// docs/modules/content/content-sync.md.
import { describe, expect, it } from "vitest";
import { contentPayload, contentSaveWarning, embeddedPictures, withStoredPictures } from "../src/features/content/contentSyncRules.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const lists = { note: "n", combos: [1], stories: [2], words: [3], grammar: [4], challenges: [5], extra: "dropped" };

describe("what one save sends", () => {
  it("the note, the five lists and the level order, nothing else", () => {
    expect(contentPayload(lists, ["Weather"])).toEqual({ note: "n", combos: [1], stories: [2], words: [3], grammar: [4], challenges: [5], levelOrder: ["Weather"] });
    expect(Object.keys(contentPayload(lists, []))).toEqual(["note", "combos", "stories", "words", "grammar", "challenges", "levelOrder"]);
  });
});

describe("the warning after a failed save", () => {
  it("a conflict shows its own message; anything else the general one", () => {
    expect(contentSaveWarning({ conflict: true, message: "Someone else saved first. Reload." })).toBe("Someone else saved first. Reload.");
    const general = "Content could not be saved to the server. Check your connection; your last change will be saved with the next edit. Take a Full Backup if this keeps happening.";
    expect(contentSaveWarning(new Error("offline"))).toBe(general);
    expect(contentSaveWarning(undefined)).toBe(general);
  });
});

describe("embedded pictures", () => {
  const words = [{ word: "Gust", image: PNG }, { word: "Mist", image: "https://example.org/mist.jpg" }, { word: "Fog" }];
  it("only data: images count", () => {
    expect(embeddedPictures(words)).toEqual([PNG]);
  });
  it("a stored picture becomes its link; other words stay the same objects", () => {
    const next = withStoredPictures(words, new Map([[PNG, "https://store/gust.png"]]));
    expect(next[0]).toEqual({ word: "Gust", image: "https://store/gust.png" });
    expect(next[1]).toBe(words[1]);
    expect(next[2]).toBe(words[2]);
  });
});
