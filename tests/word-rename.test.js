// Renaming a word to a name another word already has is refused (decision of
// the owner; merging two words is a separate feature, with a preview). A word
// is identified by its text compared without case or extra spaces; two
// meanings of one headword ("Cast", "Cast (to throw)") are different words.
import { describe, expect, it } from "vitest";
import { renameProblem } from "../src/engine/wordIdentity.js";
import { wordProblems } from "../src/features/admin/editors/WordEditor.jsx";

const words = [{ word: "Cast" }, { word: "Cast (to throw)" }, { word: "Shrink" }, { word: "Take off" }];

describe("renameProblem", () => {
  it("a free name is fine", () => {
    expect(renameProblem(words, "Shrink", "Contract")).toBeNull();
  });
  it("a name another word has is refused, whatever the case or spacing, and the message names that word", () => {
    for (const [to, named] of [["Cast", "Cast"], ["cast", "Cast"], ["  CAST ", "Cast"], ["take   OFF", "Take off"]]) {
      expect(renameProblem(words, "Shrink", to), to).toBe(`There is already a word called “${named}”. Choose another name, or edit that word.`);
    }
  });
  it("the same word spelled differently (case or spaces only) is not a clash with itself", () => {
    expect(renameProblem(words, "Shrink", "shrink")).toBeNull();
    expect(renameProblem(words, "Take off", "take  off")).toBeNull();
  });
  it("another meaning of the same headword is a different word: allowed when its own name is free", () => {
    expect(renameProblem(words, "Shrink", "Cast (to mould)")).toBeNull();
    expect(renameProblem(words, "Cast", "Cast (to throw)")).toMatch(/already a word/);
  });
  it("an empty name is refused", () => {
    for (const to of ["", "   ", null, undefined]) expect(renameProblem(words, "Shrink", to)).toMatch(/can’t be empty/);
  });
  it("a word that is not in the list is no reason to refuse", () => {
    expect(renameProblem(words, "Nope", "Contract")).toBeNull();
    expect(renameProblem([], "A", "B")).toBeNull();
  });
});

describe("the word editor says the same", () => {
  it("renaming a word to an existing one is a problem; renaming it to a free name is not", () => {
    const original = words[2];
    expect(wordProblems({ word: "Cast", category: "c" }, words, original)[0]).toMatch(/already exists/);
    expect(wordProblems({ word: "Contract", category: "c" }, words, original)).toEqual([]);
    expect(wordProblems({ word: "SHRINK", category: "c" }, words, original)).toEqual([]);
  });
});
