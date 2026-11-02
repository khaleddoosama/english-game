// The word contract (src/engine/wordContract.js, ADR 0011 step 1): the shape check on the shared cases (the same cases
// run against SQL in tests/integration/word-contract-sql.test.js), the warnings, the conversion of older shapes without
// deciding anything for the owner, partial updates, and that converting twice changes nothing. Nothing in the app
// calls the module yet. Made-up words only. Docs: docs/adr/0011-word-data-contract.md.
import { describe, expect, it } from "vitest";
import { WORD_KEYS, checkWord, convertWord, isEmpty, poolTexts, updateWord } from "../src/engine/wordContract.js";
import { WORD_CONTRACT_CASES } from "./wordContractCases.js";

const codes = (list) => list.map((e) => `${e.path}: ${e.code}`).sort();
const base = WORD_CONTRACT_CASES[0].word;
const legacy = (extra = {}) => ({ word: "Ferry", type: "vocab", category: "Travel", partsOfSpeech: ["noun"], meaning: "A boat that carries people.", situation: "We took the ferry.", gap: "We took the ______ home.", hints: ["It floats."], ...extra });

describe("the shape check, on the shared cases", () => {
  it.each(WORD_CONTRACT_CASES.map((c) => [c.name, c]))("%s", (_name, c) => {
    expect(codes(checkWord(c.word).errors)).toEqual([...c.errors].sort());
  });
});

describe("warnings (browser only, never stored)", () => {
  it("a missing part of speech, a family member without one, a reference to no word, a sentence that shows the word", () => {
    const w = { ...base, wordFamily: [{ word: "ferries" }], meaning: "A ferry carries people.", gaps: ["The ferry ______ left."], hints: ["A big boat."] };
    delete w.partsOfSpeech;
    const showsWord = (word, text) => text.toLowerCase().includes(word.toLowerCase());
    const { errors, warnings } = checkWord(w, { words: new Set(["ferry"]), showsWord });
    expect(errors).toEqual([]);
    expect(codes(warnings)).toEqual(["confusableWords[0]: no-such-word", "gaps[0]: shows-word", "meaning: shows-word", "partsOfSpeech: missing", "wordFamily[0].pos: missing"]);
  });
});

describe("empty values", () => {
  it('"", only spaces, null, [] and {} are empty; false, 0 and a missing value are not', () => {
    for (const v of ["", "  ", null, [], {}]) expect(isEmpty(v)).toBe(true);
    for (const v of [false, 0, "x", [""], { a: null }, undefined]) expect(isEmpty(v)).toBe(false);
  });
});

describe("converting a stored (older) word", () => {
  it("single fields go into their lists, empty values are removed and listed, text is tidied", () => {
    const r = convertWord(legacy({ hints: [], meaning: "  A boat  that carries people. " }));
    expect(r.word).toEqual({ word: "Ferry", type: "vocab", category: "Travel", partsOfSpeech: ["noun"], meaning: "A boat that carries people.", situations: ["We took the ferry."], gaps: ["We took the ______ home."], contract: 1 });
    expect(r.changes).toEqual(expect.arrayContaining([{ path: "hints", what: "empty-removed" }, { path: "meaning", what: "tidied" }, { path: "situation", what: "moved", to: "situations[0]" }, { path: "gap", what: "moved", to: "gaps[0]" }]));
    expect(checkWord(r.word).errors).toEqual([]);
  });
  it("a single field equal to [0] is dropped as derived", () => {
    const r = convertWord(legacy({ situations: ["We took the ferry.", "It was late."] }));
    expect(r.word.situations).toEqual(["We took the ferry.", "It was late."]);
    expect(r.changes).toContainEqual({ path: "situation", what: "derived-dropped" });
  });
  it("a conflict is reported and not decided: no word until the owner chooses", () => {
    const r = convertWord(legacy({ situation: "B was shown.", situations: ["A was first.", "C."] }));
    expect(r.word).toBeNull();
    expect(r.conflicts).toEqual([{ field: "situations", single: "B was shown.", first: "A was first.", list: ["A was first.", "C."], alsoAt: null, open: true, reason: "single-differs-from-first" }]);
  });
  it("Choice A puts the shown value first and the old [0] last; it never removes a sentence", () => {
    const r = convertWord(legacy({ situation: "B was shown.", situations: ["A was first.", "C."] }), { choices: { situations: "A" } });
    expect(r.word.situations).toEqual(["B was shown.", "C.", "A was first."]);
    expect(r.conflicts).toEqual([]);
  });
  it("Choice A keeps every pool id on the same sentence", () => {
    const old = legacy({ gap: "B ______ shown.", gaps: ["A ______ first.", "C ______ second.", "D ______ third."] });
    const before = poolTexts(old, "gaps");
    const after = poolTexts(convertWord(old, { choices: { gaps: "A" } }).word, "gaps");
    expect(before).toEqual([{ id: "seed", text: "B ______ shown." }, { id: "seed-2", text: "C ______ second." }, { id: "seed-3", text: "D ______ third." }]);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]).toEqual({ id: "seed-4", text: "A ______ first." });
  });
  it("a single value found later in the list is a conflict Choice A cannot solve without moving counts", () => {
    const r = convertWord(legacy({ situation: "C.", situations: ["A.", "C."] }), { choices: { situations: "A" } });
    expect(r.word).toBeNull();
    expect(r.conflicts[0]).toMatchObject({ reason: "single-elsewhere-in-list", alsoAt: 1 });
  });
  it("relations are flattened; an antonym missing from antonyms waits for the owner, then moves or is archived", () => {
    const raw = legacy({ antonyms: ["Bridge"], synonyms: ["Boat"], relations: { synonyms: ["Boat", "Ship"], confusableWords: ["Raft"], antonyms: ["Bridge", "Tunnel"] } });
    const open = convertWord(raw);
    expect(open.word).toBeNull();
    expect(open.antonymEntries).toEqual([{ value: "Tunnel", decision: null }]);
    const moved = convertWord(raw, { antonymChoices: { Tunnel: "move" } });
    expect(moved.word).toMatchObject({ antonyms: ["Bridge", "Tunnel"], synonyms: ["Boat", "Ship"], confusableWords: ["Raft"] });
    expect(moved.word).not.toHaveProperty("relations");
    const archived = convertWord(raw, { antonymChoices: { Tunnel: "archive" } });
    expect(archived.word.antonyms).toEqual(["Bridge"]);
    expect(archived.archive).toContainEqual({ path: "relations.antonyms", value: "Tunnel", reason: "owner-choice" });
  });
  it("a stored opposite is folded into antonyms; None means none", () => {
    expect(convertWord(legacy({ antonyms: ["Bridge"], opposite: "Bridge" })).changes).toContainEqual({ path: "opposite", what: "derived-dropped" });
    expect(convertWord(legacy({ opposite: "Tunnel" })).word.antonyms).toEqual(["Tunnel"]);
    expect(convertWord(legacy({ opposite: "None" })).word).not.toHaveProperty("antonyms");
  });
  it("retired and unknown keys go to the archive with their values; learningData keeps only cluster", () => {
    const r = convertWord(legacy({ register: "informal", acceptedWrittenAnswers: ["boat"], learningData: { cluster: "transport", difficulty: "easy" }, colour: "blue" }));
    expect(r.word.learningData).toEqual({ cluster: "transport" });
    expect(r.archive).toEqual([
      { path: "register", value: "informal", reason: "retired" },
      { path: "acceptedWrittenAnswers", value: ["boat"], reason: "retired" },
      { path: "learningData.difficulty", value: "easy", reason: "retired" },
      { path: "colour", value: "blue", reason: "unknown" },
    ]);
    expect(checkWord(r.word).errors).toEqual([]);
  });
  it("an older example is added last when it is not there yet", () => {
    expect(convertWord(legacy({ example: "It was late." })).word.situations).toEqual(["We took the ferry.", "It was late."]);
  });
  it("false and 0 are kept, for the check to refuse; they are never dropped as empty", () => {
    const r = convertWord(legacy({ level: 0, plainForm: false }));
    expect(r.word).toMatchObject({ level: 0, plainForm: false });
    expect(codes(checkWord(r.word).errors)).toEqual(["level: type", "plainForm: type"]);
  });
  it("system keys stay on a stored row", () => {
    expect(convertWord(legacy({ categoryId: "travel", _aiAdded: true })).word).toMatchObject({ categoryId: "travel", _aiAdded: true });
  });
});

describe("converting new input", () => {
  it("retired, unknown, system and v3-only keys are refused, not archived", () => {
    const r = convertWord(legacy({ register: "x", colour: "blue", _aiAdded: true, contract: 1, links: {} }), { source: "input" });
    expect(r.word).toBeNull();
    expect(codes(r.errors)).toEqual(["_aiAdded: system-key", "colour: unknown-key", "contract: system-key", "links: v3-only", "register: retired-key"]);
  });
  it("relations.antonyms in new input is new authored data: merged", () => {
    expect(convertWord(legacy({ relations: { antonyms: ["Tunnel"] } }), { source: "input" }).word.antonyms).toEqual(["Tunnel"]);
  });
});

describe("converting twice changes nothing", () => {
  const raws = [
    legacy(), legacy({ hints: [], register: "x" }), legacy({ situations: ["We took the ferry.", "B."] }),
    legacy({ relations: { synonyms: ["Boat"], confusableWords: ["Raft"] }, synonyms: [] }),
    legacy({ situation: "B.", situations: ["A.", "C."] }), legacy({ opposite: "Tunnel", learningData: { cluster: "x", difficulty: "y" } }),
    ...WORD_CONTRACT_CASES.map((c) => c.word).filter((w) => w && typeof w === "object"),
  ];
  it.each(raws.map((r, i) => [i, r]))("word %i", (_i, raw) => {
    const once = convertWord(raw, { choices: { situations: "A", gaps: "A", commonMistakes: "A" } });
    if (!once.word) return; // still open: nothing to convert again
    const twice = convertWord(once.word);
    expect(twice.word).toEqual(once.word);
    expect(twice.changes).toEqual([]);
    expect(twice.archive).toEqual([]);
  });
});

describe("partial updates", () => {
  const word = convertWord(legacy({ categoryId: "travel", subCategory: "Boats", subCategoryTitle: "Boats" })).word;
  it("an absent key keeps its value; a list replaces the whole list; an empty optional value clears it", () => {
    const r = updateWord(word, { level: "A2.3", hints: [], situations: ["One.", "Two."] });
    expect(r.errors).toEqual([]);
    expect(r.word).toMatchObject({ meaning: word.meaning, level: "A2.3", situations: ["One.", "Two."] });
    expect(r.word).not.toHaveProperty("hints");
  });
  it("an empty required value is an error, not a clear", () => {
    expect(codes(updateWord(word, { meaning: "", gaps: [] }).errors)).toEqual(["gaps: required", "meaning: required"]);
  });
  it("retired, unknown, system, derived and alias keys cannot be written", () => {
    expect(codes(updateWord(word, { register: "x", colour: "y", _aiAdded: true, situation: "z", relations: {} }).errors)).toEqual(["_aiAdded: system-key", "colour: unknown-key", "register: retired-key", "relations: not-stored", "situation: not-stored"]);
  });
  it("false and 0 are written as values (the check refuses them), never taken as clears", () => {
    expect(updateWord(word, { level: 0 }).word.level).toBe(0);
  });
  it("a category or group change drops the stale v3 ids", () => {
    expect(updateWord(word, { category: "Sea" }).word).not.toHaveProperty("categoryId");
    expect(updateWord(word, { subCategory: "Ships" }).word).not.toHaveProperty("subCategoryTitle");
    expect(updateWord(word, { meaning: "A boat that crosses water." }).word).toMatchObject({ categoryId: "travel", subCategoryTitle: "Boats" });
  });
});

describe("the key table", () => {
  it("every key of the shared base word is a stored or system key", () => {
    for (const key of Object.keys(base)) expect(["stored", "system"]).toContain(WORD_KEYS[key]?.class);
  });
});
