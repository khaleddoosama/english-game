// Grammar rules for the admin: turning a rule into an editable draft and
// back, checking it, and asking AI for more questions. A rule saved here is
// always a question set (questions[] of choose / judge / fix); an older
// single-question rule becomes the first question of its set.
import { V2 } from "../../../engine/v2";
import { managedAiFunction } from "../../../lib/aiOperations.js";
import { callAiJsonAdmin } from "../../../engine/ai";

export const GRAMMAR_TYPES = { choose: "Choose", judge: "Right or wrong?", fix: "Fix the sentence" };
// Course levels (A1.2 …) first, then plain difficulty levels.
export const GRAMMAR_LEVELS = [...V2.COURSE_LEVELS, "A1", "A2", "B1", "B2", "C1"];
export const blankGrammarQuestion = (type) => (type === "choose" ? { type, prompt: "", options: ["", "", ""], answer: "", explanation: "" } : type === "judge" ? { type, sentence: "", correct: false, fix: "", explanation: "" } : { type, sentence: "", answer: "", explanation: "" });
export const isSingleQuestionRule = (g) => !Array.isArray(g?.questions);

export function grammarDraftOf(g) {
  const { prompt, options, answer, ...rest } = g;
  return { ...rest, examples: Array.isArray(g.examples) ? g.examples : [], commonMistakes: Array.isArray(g.commonMistakes) ? g.commonMistakes.map((m) => ({ ...m })) : [], questions: (Array.isArray(g.questions) ? g.questions : V2.grammarQuestions(g)).map((q) => ({ ...q, ...(q.options ? { options: [...q.options] } : {}) })) };
}
export function blankGrammarRule(id, category) {
  return { id, rule: "", category: category || "", level: "", explanation: "", examples: [], commonMistakes: [], questions: [blankGrammarQuestion("choose")] };
}
// Tidy a draft for saving: trim text, drop empty options, examples and
// half-written mistakes.
export function cleanGrammarDraft(d) {
  const t = (x) => String(x ?? "").trim();
  const questions = (d.questions || []).map((q) => {
    const base = { type: q.type, explanation: t(q.explanation) };
    if (q.type === "choose") return { ...base, prompt: t(q.prompt), options: (q.options || []).map(t).filter(Boolean), answer: t(q.answer) };
    if (q.type === "judge") return q.correct ? { ...base, sentence: t(q.sentence), correct: true, alternative: t(q.alternative) } : { ...base, sentence: t(q.sentence), correct: false, fix: t(q.fix) };
    return { ...base, sentence: t(q.sentence), answer: t(q.answer) };
  });
  const out = { ...d, id: t(d.id), rule: t(d.rule), category: t(d.category), level: t(d.level), explanation: t(d.explanation), examples: (d.examples || []).map(t).filter(Boolean), commonMistakes: (d.commonMistakes || []).map((m) => ({ sentence: t(m.sentence), correction: t(m.correction), why: t(m.why) })).filter((m) => m.sentence && m.correction && m.why), questions };
  if (!out.level) delete out.level;
  return out;
}
// Problems that block saving, as [{ at: null | question index, text }].
export function grammarDraftProblems(d, others = []) {
  const out = [];
  if (!d.id) out.push({ at: null, text: "Id: needed (it keeps players' progress)." });
  else if (d.id.includes(":")) out.push({ at: null, text: "Id: can't contain “:”." });
  else if (others.some((g) => V2.norm(g.id) === V2.norm(d.id))) out.push({ at: null, text: "Id: another rule already uses it." });
  if (/[؀-ۿ]/.test(JSON.stringify(d))) out.push({ at: null, text: "Game content must be in English only (no Arabic)." });
  const LABELS = { rule: "Rule", category: "Lesson", explanation: "Explanation", questions: "Questions", prompt: "prompt", answer: "answer", options: "options", sentence: "sentence", fix: "fixed sentence", alternative: "other choice", correct: "right or wrong", type: "type" };
  for (const e of V2.validateContent({ kind: "content", grammar: [d] })) {
    if (/^grammar\[0\]\.id/.test(e)) continue; // covered above
    const q = e.match(/^grammar\[0\]\.questions\[(\d+)\]\.?(\w*):\s*(.*)$/);
    if (q) { out.push({ at: Number(q[1]), text: `${q[2] ? `${LABELS[q[2]] || q[2]}: ` : ""}${q[3]}` }); continue; }
    const top = e.match(/^grammar\[0\]\.(\w+):\s*(.*)$/);
    out.push({ at: null, text: top ? `${LABELS[top[1]] || top[1]}: ${top[2]}` : e });
  }
  return out;
}
// What the table flags. "danger" ones keep a rule out of the game.
export function grammarIssues(g) {
  const out = [];
  if (V2.validateContent({ kind: "content", grammar: [g] }).length) out.push({ id: "invalid", label: "has errors", tone: "danger" });
  if (!String(g.explanation || "").trim()) out.push({ id: "no-explanation", label: "no explanation", tone: "warning" });
  if (!V2.grammarQuestions(g).length) out.push({ id: "no-questions", label: "no playable questions", tone: "danger" });
  return out;
}
export const questionCount = (g) => V2.grammarQuestions(g).length;
export function questionTypes(g) {
  const c = {};
  for (const q of V2.grammarQuestions(g)) c[q.type] = (c[q.type] || 0) + 1;
  return c;
}
// A short line for the table: the first question's prompt or sentence.
export function grammarPreview(g) {
  const q = V2.grammarQuestions(g)[0];
  return q ? (q.type === "choose" ? q.prompt : q.sentence) || "" : "";
}

async function generateGrammarQuestionsImpl(rule, types, count, lessonWords, options = {}) {
  const raw = await callAiJsonAdmin(`You write grammar practice for Word Hunter, an English game for Arabic-speaking learners (A2–B1). Use simple English only. Write ${count} NEW questions for the grammar rule in the input, using only these types: ${types.join(", ")}. Spread them across the types. Do not repeat or lightly reword existingQuestions. Where it fits naturally, use words or situations from lessonWords.
Types:
- choose: {"type":"choose","prompt":"sentence with ______ or a short question","options":["3 or 4 short options"],"answer":"exactly one of the options","explanation":"one short sentence"}. Exactly one option may be correct.
- judge: {"type":"judge","sentence":"...","correct":false,"fix":"the corrected sentence","explanation":"..."} for a sentence that breaks the rule, or {"type":"judge","sentence":"...","correct":true,"alternative":"a tempting WRONG rewrite of the same sentence","explanation":"..."} for a correct one. Mix correct and wrong sentences.
- fix: {"type":"fix","sentence":"a sentence with exactly one mistake about this rule","answer":"the corrected sentence","explanation":"..."}. Change as little as possible.
Every mistake must be about this rule, and every "correct" sentence must be fully correct English. Return ONLY JSON: {"questions":[...]}`, { rule: rule.rule, explanation: rule.explanation, level: rule.level || null, examples: rule.examples || [], existingQuestions: rule.questions || [], lessonWords }, 2500, "Write grammar questions", options);
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  if (!list.length) throw new Error("AI didn't return any questions. Try again.");
  return list.map((q) => checkAiQuestion(q, types));
}
// Each AI question is cleaned and checked on its own; failures are shown
// with the reason and can't be added.
export function checkAiQuestion(q, types) {
  const clean = cleanGrammarDraft({ id: "x", rule: "x", category: "x", explanation: "x", questions: [{ ...q, options: Array.isArray(q?.options) ? q.options : [] }] }).questions[0];
  const errors = types.includes(clean.type) ? V2.validateContent({ kind: "content", grammar: [{ id: "x", rule: "x", category: "x", explanation: "x", questions: [clean] }] }) : ["type not requested"];
  return { question: clean, ok: !errors.length, reason: errors.map((e) => e.replace(/^grammar\[0\]\.questions\[0\]\.?/, "")).join("; "), selected: !errors.length };
}

export const generateGrammarQuestions = managedAiFunction("Write grammar questions", generateGrammarQuestionsImpl, 4);
