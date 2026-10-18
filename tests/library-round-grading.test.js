// Grading an answer, and what a finished round does to the player's record of
// a word: the same for a round from a view as for any other round.
import { describe, expect, it } from "vitest";
import { PRODUCTION_GATE_STEP } from "../src/engine/constants";
import { V2 } from "../src/engine/v2";
import { dictionary } from "./libraryFixtures";

describe("grading a typed answer", () => {
  const typing = (answer, extra = {}) => ({ type: "typing", mode: "typing", answers: [answer], ...extra });
  const words = dictionary(6);
  const grade = (q, value) => V2.grade(q, value, words);

  it("ignores case and spacing, inside the answer too", () => {
    expect(grade(typing("take off"), "  TAKE   off ").correct).toBe(true);
    expect(grade(typing("take off"), "takeoff").correct).toBe(false);
  });

  it("accepts the word without its meaning label, and with it", () => {
    const q = typing("Cast (to throw)");
    expect(grade(q, "cast").correct).toBe(true);
    expect(grade(q, "Cast (to throw)").correct).toBe(true);
    expect(grade(q, "cast (to throw)").correct).toBe(true);
    expect(grade(q, "cast (actors)").correct).toBe(false);
  });

  it("calls one wrong, missing or extra letter a spelling slip: not correct, but not a wrong word either", () => {
    const q = typing("campaign");
    for (const slip of ["campain", "campaignn", "kampaign"]) expect(grade(q, slip), slip).toMatchObject({ correct: false, spelling: true });
    expect(grade(q, "campaign").spelling).toBe(false);
  });

  it("two slips are a wrong answer, not a spelling one", () => {
    expect(grade(typing("campaign"), "kampaigm")).toMatchObject({ correct: false, spelling: false });      // two letters off
    expect(grade(typing("campaign"), "campain!x")).toMatchObject({ correct: false, spelling: false });
    expect(grade(typing("campaign"), "cmpaing")).toMatchObject({ correct: false, spelling: false });
  });

  it("a very short answer is never a spelling slip", () => {
    expect(grade(typing("ox"), "ax")).toMatchObject({ correct: false, spelling: false });
    expect(grade(typing("cat"), "cut")).toMatchObject({ correct: false, spelling: true });   // 3 letters is the least
  });

  it("another real word of the dictionary is a wrong answer, however close", () => {
    expect(grade(typing("Word1"), "Word2")).toMatchObject({ correct: false, spelling: false });
    expect(grade(typing("Word1"), "Wordx")).toMatchObject({ correct: false, spelling: true });
  });

  it("an empty answer, nothing at all, or only spaces, is wrong and does not throw", () => {
    for (const v of ["", "   ", undefined, null, []]) expect(grade(typing("campaign"), v).correct, String(v)).toBe(false);
  });

  it("a rewrite checked by the game itself is never marked wrong, only 'unverified'", () => {
    const q = typing("She took off her coat.", { mode: "transform", modelOnly: true });
    expect(grade(q, "She took her coat off.")).toEqual({ correct: false, spelling: false, unverified: true });
    expect(grade(q, "she took off her coat.").correct).toBe(true);
  });
});

describe("grading a choice", () => {
  it("is right only for the exact option, and never a spelling slip", () => {
    const q = { type: "mcq", mode: "reverse", answers: ["Word1"] };
    expect(V2.grade(q, "word1").correct).toBe(true);
    expect(V2.grade(q, "Word2")).toMatchObject({ correct: false, spelling: false });
    expect(V2.grade(q, "Word")).toMatchObject({ correct: false, spelling: false });
  });

  it("a pick of several needs all of them and none other, in any order", () => {
    const q = { type: "multi", mode: "multi", answers: ["Word1", "Word2"] };
    expect(V2.grade(q, ["Word2", "Word1"]).correct).toBe(true);
    expect(V2.grade(q, ["Word1"]).correct).toBe(false);
    expect(V2.grade(q, ["Word1", "Word3"]).correct).toBe(false);
    expect(V2.grade(q, ["Word1", "Word1"]).correct).toBe(false);
    expect(V2.grade(q, ["Word1", "Word2", "Word3"]).correct).toBe(false);
    expect(V2.grade(q, []).correct).toBe(false);
  });
});

describe("how well a word is known", () => {
  const rec = (extra) => ({ introducedAt: 1, ...extra });
  const modes = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { correct: 1, total: 1 }]));

  it("a word is known once it was introduced or answered", () => {
    expect([V2.known(undefined), V2.known({}), V2.known({ introducedAt: 5 }), V2.known({ total: 1 }), V2.known({ correct: 1 })]).toEqual([false, false, true, true, true]);
  });

  it("New → Familiar → Learned needs a right answer, then two, in two kinds of question", () => {
    expect(V2.stage(rec({ correct: 0, total: 3 }))).toBe("New");
    expect(V2.stage(rec({ correct: 1, total: 1, modes: modes(1) }))).toBe("Familiar");
    expect(V2.stage(rec({ correct: 2, total: 2, modes: modes(1) }))).toBe("Familiar");       // two answers of one kind are not enough
    expect(V2.stage(rec({ correct: 2, total: 2, modes: modes(2) }))).toBe("Learned");
  });

  it("Mastered needs 5 answers, 80% right, two kinds, one typed from memory and 3 separate rounds", () => {
    const base = { correct: 4, total: 5, modes: modes(2), productionCorrect: 1, evidenceV2: true, independentSessions: ["a", "b", "c"] };
    expect(V2.stage(base)).toBe("Mastered");
    expect(V2.stage({ ...base, total: 4, correct: 3 })).toBe("Learned");                      // only 4 answers
    expect(V2.stage({ ...base, correct: 3 })).toBe("Learned");                                // 60%
    expect(V2.stage({ ...base, modes: modes(1) })).toBe("Familiar");                          // one kind of question
    expect(V2.stage({ ...base, productionCorrect: 0 })).toBe("Learned");
    expect(V2.stage({ ...base, independentSessions: ["a", "b"] })).toBe("Learned");
    expect(V2.stage({ ...base, evidenceV2: false, independentSessions: [] })).toBe("Mastered");   // older records have no sessions to count
  });

  it("a word once mastered stays so until it slips three times", () => {
    expect(V2.stage({ everMastered: true, regressionStrikes: 2, correct: 0, total: 9 })).toBe("Mastered");
    expect(V2.stage({ everMastered: true, regressionStrikes: 3, correct: 1, total: 9, modes: modes(1) })).toBe("Familiar");
  });
});

describe("what a finished round does to a word", () => {
  const NOW = 1_800_000_000_000;
  const q = (target, mode, type) => ({ targets: [target], mode, type });
  const finish = (mastery, queue, answers, extra = {}) => V2.sessionEvidence(mastery, { id: "s1", kind: "practice", queue, answers, ...extra }, NOW);
  const right = (extra) => ({ correct: true, ...extra });

  it("a right answer is one more correct answer, a step up, and a review time", () => {
    const m = finish({}, [q("Word1", "reverse", "mcq")], [right()]);
    expect(m.Word1).toMatchObject({ correct: 1, total: 1, reviewStep: 1, lastResult: "correct", lastReviewedAt: NOW, regressionStrikes: 0 });
    expect(m.Word1.modes.reverse).toMatchObject({ correct: 1, total: 1 });
    expect(V2.stage(m.Word1)).toBe("Familiar");
  });

  it("one wrong answer in a word's questions this round sends it back to step 0, even if another was right", () => {
    const start = { Word1: { introducedAt: 1, correct: 2, total: 2, reviewStep: 2, modes: { reverse: { correct: 2, total: 2 } } } };
    const m = finish(start, [q("Word1", "reverse", "mcq"), q("Word1", "gap", "mcq")], [right(), { correct: false }]);
    expect(m.Word1).toMatchObject({ correct: 2, total: 3, reviewStep: 0, lastResult: "wrong" });
    expect(m.Word1.modes.gap).toMatchObject({ correct: 0, total: 1 });
    expect(m.Word1.modes.reverse).toMatchObject({ correct: 3, total: 3 });          // per kind of question, each answer counts by itself
  });

  it("a spelling slip is its own kind of miss", () => {
    const m = finish({}, [q("Word1", "typing", "typing")], [{ correct: false, spelling: true }]);
    expect(m.Word1).toMatchObject({ lastResult: "spelling", spellingMisses: 1, reviewStep: 0, correct: 0, total: 1 });
  });

  it("an answer that needed help (a hint) counts as a try, never as knowing it", () => {
    const m = finish({}, [q("Word1", "reverse", "mcq")], [right({ assisted: true })]);
    expect(m.Word1).toMatchObject({ correct: 0, total: 1, lastResult: "assisted", assistedAttempts: 1, reviewStep: 0 });
  });

  it("only a typed answer from memory counts as producing the word, and the streak waits for it", () => {
    let m = {};
    for (let i = 0; i < 4; i++) m = finish(m, [q("Word1", "reverse", "mcq")], [right()], { id: `c${i}` });
    expect(m.Word1.reviewStep).toBe(PRODUCTION_GATE_STEP);                           // held at the gate
    expect(m.Word1.productionCorrect).toBe(0);
    m = finish(m, [q("Word1", "typing", "typing")], [right()], { id: "t1" });
    expect(m.Word1.productionCorrect).toBe(1);
    expect(m.Word1.reviewStep).toBe(PRODUCTION_GATE_STEP + 1);                       // free to climb
    const rewrite = finish({}, [q("Word2", "transform", "typing")], [right()]);
    expect(rewrite.Word2.productionCorrect).toBe(0);                                 // a rewrite is not recall of the word
  });

  it("the same round is never counted twice", () => {
    const once = finish({}, [q("Word1", "reverse", "mcq")], [right()]);
    const twice = V2.sessionEvidence(once, { id: "s1", kind: "practice", queue: [q("Word1", "reverse", "mcq")], answers: [right()] }, NOW + 1000);
    expect(twice.Word1).toEqual(once.Word1);
  });

  it("leaves a word alone when its answer was reported, unverified, failed to be checked, or does not count", () => {
    for (const flag of [{ reported: true }, { unverified: true }, { aiFailed: true }]) {
      expect(finish({}, [q("Word1", "reverse", "mcq")], [right(flag)]), JSON.stringify(flag)).toEqual({});
    }
    expect(finish({}, [{ ...q("Word1", "reverse", "mcq"), noMastery: true }], [right()])).toEqual({});
    expect(finish({}, [q("Word1", "reverse", "mcq")], [right()], { kind: "speed" })).toEqual({});
    expect(finish({}, [q("Word1", "reverse", "mcq"), q("Word2", "reverse", "mcq")], [right()])).toHaveProperty("Word1");          // a question not answered yet
    expect(finish({}, [q("Word1", "reverse", "mcq"), q("Word2", "reverse", "mcq")], [right()])).not.toHaveProperty("Word2");
  });

  it("a word shown to the player before it was asked ('unfair') is not credited", () => {
    expect(finish({}, [q("Word1", "reverse", "mcq")], [right()], { unfairTargets: ["Word1"] })).toEqual({});
  });

  it("a question about two words credits both, and one wrong pick sets both back", () => {
    const pair = { targets: ["Word1", "Word2"], mode: "multi", type: "multi" };
    const ok = finish({}, [pair], [right()]);
    expect([ok.Word1.correct, ok.Word2.correct]).toEqual([1, 1]);
    const no = finish({}, [pair], [{ correct: false }]);
    expect([no.Word1.lastResult, no.Word2.lastResult]).toEqual(["wrong", "wrong"]);
  });

  it("a mastered word that is missed gains a strike; a right answer takes one back", () => {
    const mastered = { introducedAt: 1, everMastered: true, regressionStrikes: 1, correct: 9, total: 10, modes: { a: { correct: 5, total: 5 }, b: { correct: 4, total: 5 } }, productionCorrect: 2 };
    expect(finish({ Word1: mastered }, [q("Word1", "reverse", "mcq")], [{ correct: false }]).Word1.regressionStrikes).toBe(2);
    expect(finish({ Word1: mastered }, [q("Word1", "reverse", "mcq")], [right()]).Word1.regressionStrikes).toBe(0);
  });

  it("a word reaches Mastered only after right answers in several rounds, including one typed from memory", () => {
    let m = {};
    const steps = [["reverse", "mcq"], ["gap", "mcq"], ["typing", "typing"], ["reverse", "mcq"], ["typing", "typing"]];
    const stages = [];
    steps.forEach(([mode, type], i) => { m = finish(m, [q("Word1", mode, type)], [right()], { id: `r${i}` }); stages.push(V2.stage(m.Word1)); });
    expect(stages).toEqual(["Familiar", "Learned", "Learned", "Learned", "Mastered"]);
  });
});
