import { V2 } from "./v2";
import { WORDS } from "./data";
import { findWordByLabel, getWordPools, levenshtein, semanticRelation, situationLeaks } from "./questions";
/* ----------------------------- CONTENT GENERATION --------------------------- */
// Asks the model for fresh gap/situation sentences or reworded meaning clues
// for whichever (word, poolType) pairs just ran out of unlocked variants.

export function localGeneratedVariantCheck(request, text) {
  const value = String(text || "").trim();
  if (!value || value.length < 8 || value.length > 420) return false;
  const head = normalizeAnswerText(request.word);
  const normalized = normalizeAnswerText(value);
  if (request.poolType === "gap") {
    if (!value.includes("______")) return false;
    if (head && normalized.includes(head)) return false;
  }
  if ((request.poolType === "meaning" || request.poolType === "typing" || request.poolType === "situation") && head && normalized.includes(head)) return false;
  if (request.poolType === "situation" && value.split(/\s+/).length < 6) return false;
  return true;
}

export async function validateGeneratedContent(requests, generated) {
  const locallyValid = generated.map((item, index) => ({ item, index, local: localGeneratedVariantCheck(requests[index] || {}, item?.text) })).filter((x) => x.local);
  if (!locallyValid.length) return [];
  try {
    const review = await callClaudeJson(`You are the quality-control layer for generated English-learning questions. Return ONLY JSON with shape {"results":[{"index":0,"valid":true,"confidence":"high|medium|low","reason":"brief"}]}. Reject a variant if context is vague, grammar is broken, the clue reveals the answer, the expected answer is ambiguous, distractors/sibling words could fit equally well, or the situation is culturally strange without reason. Be conservative; valid must be false when confidence is low.`, {
      requests: locallyValid.map(({ index }) => ({ index, ...requests[index], generatedText: generated[index]?.text })),
    }, 900);
    const verdicts = new Map((Array.isArray(review?.results) ? review.results : []).map((v) => [Number(v.index), v]));
    return locallyValid.filter(({ index }) => {
      const v = verdicts.get(index);
      return v?.valid === true && (v.confidence === "high" || v.confidence === "medium");
    }).map(({ item }) => item);
  } catch (e) {
    console.warn("AI question quality control unavailable; using conservative local validation.", e);
    return locallyValid.map(({ item }) => item);
  }
}

export async function generateContent(batch, pools) {
  const wordByName = Object.fromEntries(WORDS.map((w) => [w.word, w]));
  const requests = batch.map(({ word, poolType }) => {
    const w = wordByName[word];
    const siblings = WORDS.filter((x) => x.category === w.category && x.word !== w.word)
      .map((x) => `${x.word} = ${x.meaning}`)
      .join(" | ");
    const existing = getWordPools(pools, w)[poolType].map((it) => it.text);
    return { word, poolType, meaning: w.meaning, category: w.category, siblings, existing };
  });

  const instructions = `Use B1-or-easier supporting language; only the target word and taught rule are exempt. You write short exercise content for an English vocabulary game. You will receive a JSON array of requests. For each request, produce ONE new piece of text for the given "poolType":

- poolType "meaning" or "typing": reword the given "meaning" definition in fresh wording. Keep the exact same core meaning — do not invent a different definition. One sentence. Do not use the headword itself.
- poolType "gap": write ONE new natural English sentence that uses the word/phrase naturally in a fresh context, then replace the word with exactly "______". The answer word (or any part of it) must NOT appear anywhere else in the sentence. Give enough context that ONLY this word fits the blank: a learner must not be able to type a different correct word (bad: "He had surgery on his left ______." — knee, elbow, hand all fit; good: "He hurt the joint in the middle of his leg, so he had surgery on his left ______."). Words in "siblings" must not fit either.
- poolType "situation": write a short 1-2 sentence scenario (use a person's name) that clearly and uniquely implies the word's meaning. The related words listed in "siblings" are close synonyms in the same category — the scenario must clearly point to THIS word and not those. Do not use the headword itself anywhere in the scenario.

For every request, avoid closely repeating anything listed in "existing" — write something meaningfully different.

Respond with ONLY a raw JSON array, no markdown fences, no commentary, matching this exact shape and the same order as the input:
[{"word": "...", "poolType": "...", "text": "..."}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${instructions}\n\nRequests:\n${JSON.stringify(requests)}` }],
    }),
  });

  const data = await response.json();
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error("Unexpected generation response shape");
  return validateGeneratedContent(requests, parsed);
}


export function extractClaudeText(data) {
  return Array.isArray(data?.content)
    ? data.content.filter((block) => block?.type === "text").map((block) => block.text || "").join("")
    : "";
}

// Scans for the first complete top-level JSON object/array in a string,
// tracking string literals (so a brace inside quoted text doesn't throw off
// the count) and brace/bracket depth (so trailing prose containing its own
// "{" or "}" — an example, a note, a second snippet — can't extend the
// match past the real end). Replaces a naive "first { to last }" slice,
// which broke as soon as anything after the JSON contained a brace.
export function extractFirstJsonValue(text) {
  const s = String(text || "");
  let start = -1;
  for (let i = 0; i < s.length; i++) { if (s[i] === "{" || s[i] === "[") { start = i; break; } }
  if (start === -1) return null;
  const open = s[start], close = open === "{" ? "}" : "]";
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export function parseJsonLoose(text) {
  const clean = String(text || "").replace(/```json|```/gi, "").trim();
  try { return JSON.parse(clean); } catch (_) {}
  const extracted = extractFirstJsonValue(clean);
  if (extracted) { try { return JSON.parse(extracted); } catch (_) {} }
  throw new Error("Invalid AI JSON");
}

export async function callClaudeJson(instructions, payload, maxTokens = 800) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: `${instructions}\n\nINPUT JSON:\n${JSON.stringify(payload)}` }],
    }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status})`);
  const data = await response.json();
  return parseJsonLoose(extractClaudeText(data));
}

export async function askAiForWord(rawTerm, existingWord = null) {
  const term=String(rawTerm||"").trim().replace(/^[^A-Za-z]+|[^A-Za-z' -]+$/g,"").replace(/\s+/g," ").slice(0,80);
  if(!term)throw new Error("Select or type an English word first.");
  const result=await callClaudeJson(`You are the Word Hunter vocabulary coach. Use English only and B1-or-easier supporting language. Explain the requested word or short phrase accurately in its most likely meaning. If an existingEntry is given, its partsOfSpeech (if present) is authoritative — keep those exact values. A word can have more than one (e.g. a noun that is also used as a verb) — list every part of speech that applies to this meaning. Return ONLY JSON with this shape: {"word":"canonical form","type":"vocab|idiom|binomial|phrasal|fyi","partsOfSpeech":["noun"],"category":"short topic","meaning":"simple definition","pronunciation":"easy readable pronunciation","situation":"one natural example sentence","gap":"the same kind of example with the target replaced by exactly ______","nearWords":[{"word":"...","difference":"..."}],"commonMistake":{"sentence":"...","correction":"...","why":"..."},"hints":["...","..."]}. Never include Arabic. The gap must not reveal the answer.`,{term,existingEntry:existingWord||null},1000);
  const partsOfSpeech=Array.isArray(existingWord?.partsOfSpeech)&&existingWord.partsOfSpeech.length?existingWord.partsOfSpeech:(Array.isArray(result.partsOfSpeech)?result.partsOfSpeech.map(String).filter(Boolean):[]);
  const entry={word:String(result.word||term).trim(),type:["vocab","idiom","binomial","phrasal","fyi"].includes(result.type)?result.type:"vocab",partsOfSpeech,category:String(result.category||"AI Discoveries").trim(),meaning:String(result.meaning||"").trim(),situation:String(result.situation||"").trim(),gap:String(result.gap||"").trim(),hints:Array.isArray(result.hints)?result.hints.map(String).filter(Boolean).slice(0,3):[]};
  if(result.commonMistake?.sentence&&result.commonMistake?.correction&&result.commonMistake?.why)entry.commonMistake={sentence:String(result.commonMistake.sentence),correction:String(result.commonMistake.correction),why:String(result.commonMistake.why)};
  if(!entry.meaning||!entry.situation||!entry.gap.includes("______"))throw new Error("AI returned an incomplete vocabulary card. Try again.");
  return {...result,...entry};
}

export async function aiFixImportJson(rawText, errorText) {
  const clean = String(rawText || "").trim();
  if (!clean) throw new Error("Nothing to fix — paste or upload JSON first.");
  if (clean.length > 60000) throw new Error("This file is too large for AI auto-fix in one pass — split it into smaller chunks and fix each separately.");
  const result = await callClaudeJson(
    `You are repairing a JSON document for the "Word Hunter" English vocabulary game's Admin import. The document below failed validation. You are given the exact validator error messages and the raw text the person pasted or uploaded (it may not even be valid JSON yet — fix syntax errors too if present).
Rules:
- Fix ONLY what the listed errors require. Do not rewrite, rephrase, reorder, or "improve" any field, sentence, or value that wasn't flagged.
- Every "word" value (in the words array) and every "id" value (in grammar/stories/combos/challenges) is a stable progress key — never change, rename, or regenerate one of these unless an error explicitly says the id/word itself is invalid (e.g. missing or duplicate).
- If a required field is completely missing or empty and an error flags it, write a short, reasonable, English-only placeholder value that keeps the schema valid, and mention that placeholder in "changes" so a human reviews it — never guess elaborate content silently.
- Keep the overall JSON shape (schemaVersion, kind, note, and array names) exactly as given; do not add or remove top-level fields beyond what's needed to fix an error.
- If some errors genuinely cannot be fixed without information only the author has (e.g. an ambiguous duplicate you can't safely merge), leave that item as-is and explain why in "changes" instead of guessing.
Return ONLY JSON with this exact shape: {"fixed": <the complete corrected JSON document, valid JSON>, "changes": ["short plain-English description of each fix made, in the order applied"]}`,
    { validationErrors: String(errorText || "").split("\n").filter(Boolean), rawJson: clean },
    8000
  );
  if (!result || typeof result !== "object" || result.fixed === undefined) throw new Error("AI didn't return a usable fix. Try again or edit manually.");
  if (!Array.isArray(result.changes)) result.changes = [];
  return result;
}

// Given a reported question and the exact authored content object that
// generated it, asks the AI to propose a targeted correction. Scoped to a
// single content item (a word, grammar rule, combo, challenge or pun) —
// never a whole document — so the fix stays small and reviewable.
export async function suggestReportFix(report, sourceItem, sourceEntity) {
  const singular = sourceEntity === "words" ? "word" : sourceEntity.slice(0, -1);
  const result = await callClaudeJson(
    `You are the content-quality reviewer for "Word Hunter", an English vocabulary game. A learner reported a specific question as having a problem. You are given the report (why they flagged it, the question type/mode, the exact prompt they saw, the options shown, and the correct answer(s)) plus the exact authored ${singular} entry that generated that question. Propose a corrected version of ONLY the field(s) that need to change to fix the reported problem — leave every other field exactly as given. The "word" or "id" field is a stable progress key and must NEVER change.
Common causes worth checking: the situation/gap/prompt text accidentally contains or reveals the answer word itself; the meaning is ambiguous, wrong, or too close to another word's meaning; a gap sentence has more than one blank or more than one plausible correct word; a grammar rule's options don't clearly have exactly one correct answer; a commonMistake example doesn't match its paired situation.
If the report's reason doesn't map to an obvious fix, make your best conservative improvement to the field(s) most likely responsible and explain your reasoning in "changes" — never leave "fixed" identical to the input with an empty "changes" list.
Return ONLY JSON with this exact shape: {"fixed": <the complete corrected ${singular} object, same keys/shape as the input>, "changes": ["short plain-English description of each change made"]}`,
    { report: { reason: report.reason || null, details: report.details || null, mode: report.mode, prompt: report.prompt, options: report.options || null, answers: report.answers || null }, entity: sourceEntity, currentContent: sourceItem },
    1500
  );
  if (!result || typeof result !== "object" || !result.fixed) throw new Error("AI didn't return a usable fix. Try again or edit manually in Content Manager.");
  if (!Array.isArray(result.changes)) result.changes = [];
  return result;
}

// Reports carry a questionId like "combo:combo-project-leader-1:seed" or
// "grammar:g-42:variant-2" or "challenge:ch-7" (mode.js builds these in
// V2.practice) or, for a plain word question, just "<word>:<mode>". This
// walks that back to the exact authored entry so a fix can target it.
export function locateReportSource(content, report) {
  const qid=String(report.questionId||"");
  for(const [prefix,entityId] of [["combo:","combos"],["grammar:","grammar"],["challenge:","challenges"]]){
    if(qid.startsWith(prefix)){
      const id=qid.slice(prefix.length).split(":")[0];
      const item=(content[entityId]||[]).find(x=>x.id===id);
      return item?{entity:entityId,item}:null;
    }
  }
  const wordName=report.targetWords?.[0]||qid.split(":")[0];
  const item=(content.words||[]).find(w=>V2.norm(w.word)===V2.norm(wordName));
  return item?{entity:"words",item}:null;
}

// Runs the moment a learner submits a report. One call both triages the
// report (is the question actually flawed, and was the learner's answer
// acceptable?) and, when it is flawed, drafts a fix to the authored entry.
// The learner sees the verdict right away; the admin gets the fix
// pre-computed on the report, still applied only by an explicit click.
export async function reviewReportedQuestion(report, source) {
  const singular = source ? (source.entity === "words" ? "word" : source.entity.slice(0, -1)) : null;
  const keyField = source?.entity === "words" ? "word" : "id";
  const result = await callClaudeJson(
    `You are the content-quality reviewer for "Word Hunter", an English vocabulary game. A learner just reported a question. You get the report (the reason they picked, "details" = what they wrote in their own words, the question mode/type, the exact prompt, the options shown, the correct answer(s), and the learner's own answer if they had already answered) plus, when available, the authored ${singular || "content"} entry that generated the question.
"details" is the learner's real complaint and matters most. It may be in Arabic or mixed Arabic/English: read it carefully and answer THAT complaint, not a generic one.
Judge the question exactly as the learner saw it. The learner does NOT know which vocabulary entry the question came from, so "the question is about word X" is never a reason to reject an answer. For a typing or gap question, if the learner's answer fits the sentence naturally, correctly and with a sensible meaning (for example "elbow" in "He had surgery on his left ______."), the question is "flawed" (more than one correct answer) and learnerAnswerAcceptable is true; the fix adds context so only the target word fits.
Decide honestly:
- "flawed": the question really has a problem (answer leaked in the prompt, wrong or missing correct answer, more than one defensible answer, confusing wording, typo, a valid learner answer wrongly rejected).
- "repeated": the complaint is only that the question or sentence keeps coming back; the content itself is fine.
- "fine": the question is correct and clear; the learner's complaint does not hold.
- "unsure": you cannot tell with confidence.
If the learner gave an answer, set "learnerAnswerAcceptable" to true only if it is a genuinely correct answer to the question as shown; otherwise false. Use null if they gave no answer.
"explanation" is shown to the learner: 1-2 short sentences, English only, B1-or-easier, friendly, and it must respond to what they wrote. For "fine", explain why the expected answer is right (and why theirs isn't, if they answered). For "flawed", say briefly what is wrong. For "repeated", thank them and say this question will rest for a while.
"adminNote" is one short sentence for the content author.
Only when the verdict is "flawed" AND an authored entry is given, return "fixed": the complete corrected entry with the same keys/shape, changing ONLY the field(s) needed to fix the problem, and list each change in "changes". The "${keyField}" field is a stable progress key and must NEVER change. Otherwise set "fixed" to null and "changes" to [].
Return ONLY JSON with this exact shape: {"verdict":"flawed|repeated|fine|unsure","confidence":"high|medium|low","learnerAnswerAcceptable":true,"explanation":"...","adminNote":"...","fixed":null,"changes":[]}`,
    {
      report: { reason: report.reason || null, details: report.details || null, mode: report.mode, type: report.type || null, prompt: report.prompt, options: report.options || null, answers: report.answers || null, learnerAnswer: report.learnerAnswer ?? null },
      entity: source?.entity || null,
      currentContent: source?.item || null,
    },
    1800
  );
  if (!result || typeof result !== "object") throw new Error("AI didn't return a usable review.");
  const verdict = ["flawed", "repeated", "fine", "unsure"].includes(result.verdict) ? result.verdict : "unsure";
  let fixed = verdict === "flawed" && source && result.fixed && typeof result.fixed === "object" && !Array.isArray(result.fixed) ? result.fixed : null;
  // The progress key is never allowed to drift, whatever the model returned.
  if (fixed) fixed = { ...fixed, [keyField]: source.item[keyField] };
  return {
    verdict,
    confidence: ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low",
    learnerAnswerAcceptable: typeof result.learnerAnswerAcceptable === "boolean" && report.learnerAnswer != null ? result.learnerAnswerAcceptable : null,
    explanation: String(result.explanation || "").slice(0, 400),
    adminNote: String(result.adminNote || "").slice(0, 300),
    fixed,
    entity: fixed ? source.entity : null,
    changes: fixed && Array.isArray(result.changes) ? result.changes.map(String).slice(0, 10) : [],
    at: Date.now(),
  };
}

// Two category names are the same topic written differently when they
// match after dropping case, punctuation, spacing, "&" and "and"
// ("Food Dining" / "Food-Dining", "Restaurants And Eating Out" /
// "Restaurants-and-Eating-Out"). Canonical = the name holding more items.
export function categoryKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " ").replace(/\band\b/g, " ").replace(/[^a-z]/g, "");
}
export function findCategoryDuplicates(names, counts) {
  const groups = new Map();
  for (const name of new Set(names.filter(Boolean))) {
    const key = categoryKey(name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const sorted = [...g].sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || (/[ &]/.test(b) ? 1 : 0) - (/[ &]/.test(a) ? 1 : 0));
    return { canonical: sorted[0], duplicates: sorted.slice(1) };
  });
}

// ---- Content Health: find weak word entries and fix them with AI ----
export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "noun phrase", "verb phrase", "adjective phrase", "adverbial phrase", "phrasal verb", "idiom", "expression", "binomial phrase", "proper noun", "interjection", "preposition", "conjunction"];
export const antonymsOfWord = (w) => V2.antonymsOf(w);
export const HEALTH_CHECKS = {
  situation: { label: "Situation doesn't use the word", help: "The situation is the word's example sentence, so it should contain the word. AI rewrites missing or scenario-style situations as one natural example sentence that uses the word.", field: "situation", test: (w) => !w.situation || !situationLeaks(w) },
  meaning: { label: "Weak meaning", help: "Very short, \"Opposite of …\", or contains the word. Hard to type the word from. AI writes one clear B1 definition.", field: "meaning", test: (w) => { const m = String(w.meaning || "").trim(); return !m || m.split(/\s+/).length < 4 || /^opposite of/i.test(m) || normalizeAnswerText(m).includes(normalizeAnswerText(w.word)); } },
  duplicate: { label: "Same meaning as another word", help: "Two words share the exact same definition, so a question has two right answers. AI rewrites each so they can be told apart.", field: "meaning", test: null },
  commonMistake: { label: "Missing common mistake", help: "Grammar Court questions need a typical learner mistake, its correction and a short why.", field: "commonMistake", test: (w) => !(w.commonMistake?.sentence && w.commonMistake?.correction && w.commonMistake?.why) },
  partsOfSpeech: { label: "Missing part of speech", help: "Helps the game and the learning cards describe the word.", field: "partsOfSpeech", test: (w) => !(Array.isArray(w.partsOfSpeech) && w.partsOfSpeech.length) },
  gaps: { label: "Gap sentences not checked yet", help: "AI checks whether another word could also fill each gap (like \"elbow\" in \"He had surgery on his left ______.\") and rewrites only those. Words with clear gaps are marked as checked; a changed gap is checked again.", field: "gaps", test: (w) => gapsOf(w).length > 0 && w.gapsCheckedFor !== gapsKey(gapsOf(w)) },
};
// A word's gap sentences (v3 list, or the single older gap) and a key that
// changes whenever any of them changes.
export function gapsOf(w) { return Array.isArray(w?.gaps) && w.gaps.length ? w.gaps : w?.gap ? [w.gap] : []; }
export function gapsKey(list) { return list.map((g) => V2.sentence(g)).join(" | "); }
export function scanContentHealth(words) {
  const out = {};
  for (const [id, check] of Object.entries(HEALTH_CHECKS)) if (check.test) out[id] = words.filter((w) => check.test(w));
  const byMeaning = new Map();
  for (const w of words) { const key = normalizeAnswerText(w.meaning).replace(/[^a-z0-9 ]/g, ""); if (!key) continue; if (!byMeaning.has(key)) byMeaning.set(key, []); byMeaning.get(key).push(w); }
  out.duplicate = [...byMeaning.values()].filter((g) => g.length > 1).flat();
  return out;
}
export const HEALTH_INSTRUCTIONS = {
  situation: `For each word, write a NEW "situation": ONE natural example sentence (B1 English) that uses the word/phrase exactly as written, in a context that makes its meaning clear. Keep the same sense as the current meaning. Return {"results":[{"word":"...","value":"the new example sentence"}]}.`,
  meaning: `For each word, write a NEW "meaning": ONE clear sentence, B1 English, precise enough that a learner could type the exact word from it. Never use the word/phrase itself or "opposite of". Keep the same sense as the current meaning and situation. If "sameMeaningAs" is given, make the definitions clearly different from those words. Return {"results":[{"word":"...","value":"the new meaning"}]}.`,
  commonMistake: `For each word, write a typical B1 learner mistake when using it: "sentence" (the wrong sentence), "correction" (the same sentence fixed), "why" (one short simple reason). The mistake must be about using THIS word (form, preposition, collocation or meaning). Return {"results":[{"word":"...","value":{"sentence":"...","correction":"...","why":"..."}}]}.`,
  partsOfSpeech: `For each word, list its part(s) of speech for the meaning given, using ONLY these values: ${PARTS_OF_SPEECH.join(", ")}. Return {"results":[{"word":"...","value":["noun"]}]}.`,
  gaps: `Each word has "gaps": sentences with the word replaced by "______". Learners TYPE the missing word, so check each gap: could a learner fill it with a different common word, or with one of the "siblings", and still make a correct, natural sentence? (Bad: "He had surgery on his left ______." — knee, elbow, hand all fit. Bad: "The ______ on the corner is open 24 hours." — pharmacy, shop, market all fit.) A true synonym of the word is not a problem. Keep every clear gap exactly as it is. Rewrite only the ambiguous ones: same word and meaning, one natural B1 sentence of at most 25 words, exactly one "______", and enough context that only this word fits. The word (or any part of it) must not appear in the sentence. Return {"results":[{"word":"...","value":["every gap, kept or rewritten, in the same order"],"why":"one short reason for the rewrites, or \"clear\""}]}.`,
};
export async function aiFixWordBatch(kind, words, allWords) {
  const instructionKind = kind === "duplicate" ? "meaning" : kind;
  const payload = words.map((w) => ({
    word: w.word, type: w.type, category: w.category, meaning: w.meaning, situation: w.situation, ...(kind === "gaps" ? { gaps: gapsOf(w) } : { gap: w.gap }),
    siblings: allWords.filter((x) => x.category === w.category && x.word !== w.word).slice(0, 25).map((x) => x.word),
    ...(kind === "duplicate" ? { sameMeaningAs: allWords.filter((x) => x.word !== w.word && normalizeAnswerText(x.meaning) === normalizeAnswerText(w.meaning)).map((x) => x.word) } : {}),
  }));
  const raw = await callClaudeJson(`You improve content for "Word Hunter", an English vocabulary game for B1 learners. English only. ${HEALTH_INSTRUCTIONS[instructionKind]} Return ONLY that JSON, one result per input word, same order.`, { words: payload }, 2500);
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return words.map((w) => {
    const hit = results.find((r) => normalizeAnswerText(r?.word) === normalizeAnswerText(w.word));
    const problem = (msg) => ({ word: w.word, ok: false, reason: msg });
    if (!hit) return problem("AI returned nothing for this word.");
    const v = hit.value;
    if (/[\u0600-\u06FF]/.test(JSON.stringify(v ?? ""))) return problem("Contained non-English text.");
    if (instructionKind === "gaps") {
      const before = gapsOf(w), after = Array.isArray(v) ? v.map((g) => String(g || "").trim()) : [];
      if (after.length !== before.length) return problem("AI returned a different number of gaps.");
      for (const g of after) {
        if ((g.match(/_{2,}/g) || []).length !== 1) return problem(`Needs exactly one blank: "${g}"`);
        if (situationLeaks(w, g)) return problem(`Gives the word away: "${g}"`);
      }
      if (after.every((g, i) => V2.sentence(g) === V2.sentence(before[i]))) return { word: w.word, ok: false, fine: true, reason: "Gaps are clear." };
      const changed = after.map((g, i) => i).filter((i) => V2.sentence(after[i]) !== V2.sentence(before[i]));
      return { word: w.word, ok: true, field: "gaps", before, after, shownBefore: changed.map((i) => before[i]), shownAfter: changed.map((i) => after[i]), reason: String(hit.why || "").slice(0, 200) };
    }
    if (instructionKind === "situation") {
      const text = String(v || "").trim();
      if (text.split(/\s+/).length < 6) return problem("Too short.");
      if (!situationLeaks(w, text)) return problem("Doesn't use the word.");
      return { word: w.word, ok: true, field: "situation", before: w.situation, after: text };
    }
    if (instructionKind === "meaning") {
      const text = String(v || "").trim();
      if (text.split(/\s+/).length < 4) return problem("Too short.");
      if (normalizeAnswerText(text).includes(normalizeAnswerText(w.word))) return problem("Contains the word.");
      if (/^opposite of/i.test(text)) return problem("Still an \"opposite of\" definition.");
      // 'Opposite of "Heave".' carries real information: keep it by moving
      // the named word into the opposite field (when it's a known word and
      // no opposite is set yet) instead of losing it with the old meaning.
      const named = String(w.meaning || "").trim().match(/^opposite of\s*["“']?(.+?)["”']?\s*\.?$/i)?.[1];
      const oppositeWord = named && allWords.find((x) => normalizeAnswerText(x.word) === normalizeAnswerText(named) && x.word !== w.word)?.word;
      const extra = oppositeWord && !antonymsOfWord(w).some((a) => normalizeAnswerText(a) === normalizeAnswerText(oppositeWord)) ? { antonyms: [...antonymsOfWord(w), oppositeWord] } : null;
      return { word: w.word, ok: true, field: "meaning", before: w.meaning, after: text, ...(extra ? { extra } : {}) };
    }
    if (instructionKind === "commonMistake") {
      const cm = v && typeof v === "object" ? { sentence: String(v.sentence || "").trim(), correction: String(v.correction || "").trim(), why: String(v.why || "").trim() } : null;
      if (!cm || !cm.sentence || !cm.correction || !cm.why) return problem("Incomplete mistake.");
      if (normalizeAnswerText(cm.sentence) === normalizeAnswerText(cm.correction)) return problem("Mistake and correction are identical.");
      return { word: w.word, ok: true, field: "commonMistake", before: w.commonMistake || null, after: cm };
    }
    const pos = [...new Set((Array.isArray(v) ? v : [v]).map((x) => String(x || "").trim().toLowerCase()).filter((x) => PARTS_OF_SPEECH.includes(x)))];
    if (!pos.length) return problem("No valid part of speech.");
    return { word: w.word, ok: true, field: "partsOfSpeech", before: w.partsOfSpeech || null, after: pos };
  });
}

// Scans every distinct category name in use and proposes groups that are
// clearly the same topic written differently (punctuation, spacing,
// word order, abbreviation) — never merely related-but-distinct topics.
// Returns only groups the model is confident about; the admin still
// applies each merge explicitly via applyCategoryMerge in AdminControlCenter.
export async function suggestCategoryMerges(categories) {
  const result = await callClaudeJson(
    `You are cleaning up the category taxonomy for "Word Hunter", an English vocabulary game's admin panel. You are given every distinct category name currently in use. Find groups of names that are clearly the SAME topic written differently — different punctuation, spacing, capitalization, word order, singular/plural, or an abbreviation (e.g. "Environment-Nature" vs "Environment & Nature"). Do NOT merge categories that are merely related but distinct topics (e.g. "Food" and "Cooking" stay separate; "Personality" and "Emotions" stay separate). Only propose a merge when confident a content author would consider them literally the same category. For each group, pick whichever existing name is best-formatted as the canonical one — never invent a new name not already in the list. Return ONLY JSON with shape {"merges": [{"canonical": "exact existing name", "duplicates": ["exact existing name", "..."]}]}. Omit any category with no duplicates — only include groups of 2+ names.`,
    { categories },
    2000
  );
  if (!result || !Array.isArray(result.merges)) throw new Error("AI didn't return a usable suggestion.");
  const known = new Set(categories);
  return result.merges
    .map(m => ({ canonical: String(m.canonical || "").trim(), duplicates: (Array.isArray(m.duplicates) ? m.duplicates : []).map(String).map(s => s.trim()).filter(d => d && d !== m.canonical && known.has(d)) }))
    .filter(m => m.canonical && known.has(m.canonical) && m.duplicates.length);
}

export const FREEFORM_EVALUATION_CONTRACT = `Use B1-or-easier explanations. You are a conservative English-learning evaluator inside Word Hunter. Return ONLY one JSON object. Never reward random word stuffing. Accept beginner/intermediate English when the target meaning is genuinely correct. Minor grammar mistakes may still be acceptable if meaning is clear. If uncertain, set confidence to "low" and correct to false.
Required shape:
{"correct":true,"confidence":"high|medium|low","targetWordUsed":true,"semanticUse":"correct|partly_correct|incorrect|not_applicable","grammar":"acceptable|minor_issues|meaning_breaking","naturalness":"natural|acceptable|awkward|nonsense","spellingIssue":false,"feedback":"one concise sentence","suggestedCorrection":"optional concise correction"}`;

export function validateEvaluation(raw, kind) {
  const allowedConfidence = new Set(["high", "medium", "low"]);
  const allowedSemantic = new Set(["correct", "partly_correct", "incorrect", "not_applicable"]);
  const allowedGrammar = new Set(["acceptable", "minor_issues", "meaning_breaking"]);
  const allowedNatural = new Set(["natural", "acceptable", "awkward", "nonsense"]);
  if (!raw || typeof raw !== "object") throw new Error("Invalid evaluation");
  const result = {
    correct: raw.correct === true,
    confidence: allowedConfidence.has(raw.confidence) ? raw.confidence : "low",
    targetWordUsed: raw.targetWordUsed === true,
    semanticUse: allowedSemantic.has(raw.semanticUse) ? raw.semanticUse : "incorrect",
    grammar: allowedGrammar.has(raw.grammar) ? raw.grammar : "meaning_breaking",
    naturalness: allowedNatural.has(raw.naturalness) ? raw.naturalness : "nonsense",
    spellingIssue: raw.spellingIssue === true,
    feedback: String(raw.feedback || "").slice(0, 260),
    suggestedCorrection: String(raw.suggestedCorrection || "").slice(0, 260),
  };
  const requiresTarget = kind === "sentence" || kind === "phrasalTransform";
  if (requiresTarget && !result.targetWordUsed) result.correct = false;
  if (result.semanticUse === "incorrect" || result.grammar === "meaning_breaking" || result.naturalness === "nonsense") result.correct = false;
  if (result.confidence === "low") result.correct = false;
  result.grade = result.correct
    ? (result.grammar === "acceptable" && result.naturalness === "natural" ? "Excellent" : "Good Evidence")
    : (result.semanticUse === "partly_correct" && result.naturalness !== "nonsense" ? "Almost" : "Incorrect Use");
  return result;
}

export const REGENERATE_CONTRACT = `You write vocabulary content for an English-learning game aimed at B1-level (intermediate) learners. Rewrite the meaning and example sentence for the given word or phrase. Hard rules: the meaning must be ONE simple sentence using only A2-B1 vocabulary and grammar, and it must NOT contain the target word/phrase itself. The example must be ONE natural sentence, also B1-level or simpler, that clearly shows the word/phrase used with its intended meaning. If partsOfSpeech is given, the new meaning and example must use the word as that exact part of speech — do not drift to a different sense (e.g. a different meaning of the same spelling) or a different grammatical role. Do not reuse the current meaning or example verbatim — produce a genuinely different phrasing. Return ONLY one JSON object with this exact shape: {"meaning":"...","situation":"..."}`;

export async function regenerateWordExplanation(word) {
  const raw = await callClaudeJson(REGENERATE_CONTRACT, {
    word: word.word,
    type: word.type,
    partsOfSpeech: word.partsOfSpeech || [],
    category: word.category,
    currentMeaning: word.meaning,
    currentExample: word.situation,
  }, 400);
  if (!raw || typeof raw.meaning !== "string" || typeof raw.situation !== "string" || !raw.meaning.trim() || !raw.situation.trim()) {
    throw new Error("Invalid regeneration response");
  }
  return { meaning: raw.meaning.trim(), situation: raw.situation.trim() };
}

export const STORY_GENERATION_CONTRACT = `You create a B1 graded-reader mystery for Word Hunter. The learner must infer hidden vocabulary from events.

NON-NEGOTIABLE RULES:
1. Use every target concept exactly once as a distinct event, action, feeling, decision, or reaction.
2. NEVER write any target word or phrase in the title, story, dialogue, or question prompts. Also avoid its plural, tense, -ed/-ing form, obvious word-family form, and any near-synonym that directly gives away the answer. Be especially careful with idioms and phrasal verbs — depict the EFFECT or RESULT of the concept, never the phrase itself.
3. Show meanings through concrete evidence: who did what, what happened next, and how another person reacted. Do not write dictionary definitions.
4. Mix the selected categories into one coherent plot. Do not create separate mini-paragraphs that feel unrelated.
5. Write 10-20 sentences — use the higher end when there are more targets. Use B1-or-easier supporting English. Give people clear names and keep the event order easy to follow. Each target concept needs its own clear moment in the story; never rush two concepts into the same sentence.
6. Write exactly one question for every target (order doesn't matter, but every target word must be covered once). Each question must point to one specific named event in the story and require reading the story. A reader who sees only the question must not be able to answer it.
7. Do not ask "Which word means...?", "What is the word for...?", or any dictionary-style question.
8. The explanation may reveal the target after answering and must briefly connect it to the exact story evidence.
9. Use plain straight quotes ' " and a plain hyphen -, not curly quotes or em/en dashes, so sentences can be matched exactly across fields.
10. If "grammarRules" is provided (may be empty), naturally work one clear, unambiguous example sentence of each rule into the story text — a real sentence a character says or the narration uses, not a bolted-on example. For each rule, in the same order, return a grammarQuestions entry: {"rule":"...","promptSentence":"the exact sentence from the story with EXACTLY ONE tested span replaced by a single ______ blank","options":["correct form","wrong form", ...2-3 total],"answer":"the correct form","explanation":"..."}. Use exactly one ______ in promptSentence, never two — for paired structures (either/or, neither/nor, not only/but also, comparatives, etc.) keep one half of the pair written out in the sentence and blank only the other half, so a single answer fills the single blank. promptSentence with the blank filled back in by answer must be an exact substring of the story text (same words, same order). Wrong options must be plausible incorrect forms of the same grammar point (wrong tense/preposition/agreement/word order/pairing word), not unrelated words. If grammarRules is empty, return "grammarQuestions":[].

Return ONLY: {"title":"...","text":"...","questions":[{"targetWord":"...","prompt":"...","explanation":"..."}],"grammarQuestions":[...]}`;


// A target word must never appear in the generated story itself — the whole
// point is to depict its meaning through events, not to name it (see the
// contract above). Never trust the model's word on this alone: verify with a
// whole-word, inflection-tolerant match (and a plain substring check for
// multi-word phrases) and reject the story if any target leaked through.
// Common irregular verbs that show up as the first word of idioms/phrasal
// verbs (get/got, bite/bit, ...) — plain suffix rules can't catch these.
export const IRREGULAR_VERB_FORMS = {
  get: ["got", "gotten", "getting"], give: ["gave", "given", "giving"], take: ["took", "taken", "taking"],
  go: ["went", "gone", "going"], come: ["came", "coming"], run: ["ran", "running"], break: ["broke", "broken", "breaking"],
  bite: ["bit", "bitten", "biting"], speak: ["spoke", "spoken", "speaking"], see: ["saw", "seen", "seeing"],
  do: ["did", "done", "doing"], say: ["said", "saying"], tell: ["told", "telling"], think: ["thought", "thinking"],
  find: ["found", "finding"], leave: ["left", "leaving"], feel: ["felt", "feeling"], keep: ["kept", "keeping"],
  hold: ["held", "holding"], bring: ["brought", "bringing"], buy: ["bought", "buying"], catch: ["caught", "catching"],
  fight: ["fought", "fighting"], win: ["won", "winning"], lose: ["lost", "losing"], sit: ["sat", "sitting"],
  stand: ["stood", "standing"], fall: ["fell", "fallen", "falling"], throw: ["threw", "thrown", "throwing"],
  know: ["knew", "known", "knowing"], wear: ["wore", "worn", "wearing"], drive: ["drove", "driven", "driving"],
  write: ["wrote", "written", "writing"], meet: ["met", "meeting"], pay: ["paid", "paying"], sell: ["sold", "selling"],
  understand: ["understood", "understanding"], wake: ["woke", "woken", "waking"], begin: ["began", "begun", "beginning"],
  drink: ["drank", "drunk", "drinking"], eat: ["ate", "eaten", "eating"], forget: ["forgot", "forgotten", "forgetting"],
  choose: ["chose", "chosen", "choosing"], blow: ["blew", "blown", "blowing"], draw: ["drew", "drawn", "drawing"],
  fly: ["flew", "flown", "flying"], grow: ["grew", "grown", "growing"], swear: ["swore", "sworn", "swearing"],
  tear: ["tore", "torn", "tearing"], ride: ["rode", "ridden", "riding"], hide: ["hid", "hidden", "hiding"],
  send: ["sent", "sending"], spend: ["spent", "spending"], lend: ["lent", "lending"], build: ["built", "building"],
  deal: ["dealt", "dealing"], mean: ["meant", "meaning"], lead: ["led", "leading"], shoot: ["shot", "shooting"],
  steal: ["stole", "stolen", "stealing"], swim: ["swam", "swum", "swimming"],
};
export function storyTextLeaksWord(word, text) {
  const parts = String(word || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const irregular = IRREGULAR_VERB_FORMS[parts[0].toLowerCase()];
  const firstAlternatives = [`${escape(parts[0])}(e?s|e?d|ing)?`, ...(irregular ? irregular.map(escape) : [])];
  const firstPattern = `(?:${firstAlternatives.join("|")})`;
  const rest = parts.slice(1).map(escape).join("\\s+");
  const pattern = rest ? `\\b${firstPattern}\\s+${rest}\\b` : `\\b${firstPattern}\\b`;
  return new RegExp(pattern, "i").test(text);
}

// A grammar question generated alongside the story is only trustworthy if
// its example sentence genuinely came from the story text — otherwise the
// AI could invent a plausible-looking sentence that was never actually
// woven into the plot. Filling the blank back in and checking it's a real
// substring of the story (whitespace/case-insensitive) is the ground truth.
export function grammarSentenceIsGrounded(promptSentence, answer, storyText) {
  if (typeof promptSentence !== "string" || !promptSentence.includes("______")) return false;
  if (typeof answer !== "string" || !answer.trim()) return false;
  const filled = promptSentence.replace("______", answer);
  // The model sometimes writes the same sentence with different Unicode
  // punctuation in the two fields (curly vs straight quotes, en/em dash vs
  // hyphen) even though it's the same wording — fold those before comparing
  // so a real match isn't rejected over typography alone.
  const norm = (s) => String(s || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return norm(storyText).includes(norm(filled));
}

export async function generateStory(targetWords, selectedCategories=[], grammarRules=[], attempt=1, _leakyWords=new Set()) {
  // On retry, swap out any word that leaked in a previous attempt with a
  // fresh candidate of the same type from the same category pool.
  const activeTargets = targetWords.map(w => {
    if (!_leakyWords.has(V2.norm(w.word))) return w;
    // pick a different word of the same type from the same category
    const alt = WORDS.filter(c => c.category === w.category && c.type === w.type && V2.norm(c.word) !== V2.norm(w.word) && !targetWords.some(t => V2.norm(t.word) === V2.norm(c.word))).sort(() => Math.random() - 0.5)[0];
    return alt || w; // fall back to original if no swap available
  });

  const raw = await callClaudeJson(STORY_GENERATION_CONTRACT, {
    selectedCategories,
    targetWords: activeTargets.map(w => ({ word: w.word, type: w.type, category: w.category, meaning: w.meaning, exampleContext: w.situation })),
    grammarRules: grammarRules.map(g => ({ rule: g.rule, category: g.category })),
    ...(attempt > 1 ? { retryNotice: `Attempt ${attempt}/3. Previous attempt failed. Be extra careful: depict every target purely through events; never write the word itself, an inflected form, or a near-synonym. For idioms and phrasal verbs, describe only the outcome or behaviour — never the phrase.` } : {}),
  }, 2400);

  if (!raw || typeof raw.title !== "string" || typeof raw.text !== "string" || !Array.isArray(raw.questions) || !raw.questions.length)
    throw new Error("Invalid story response — the model returned an unexpected format.");

  // ── vocab leak check — identify WHICH words leaked for smart retry ──
  const leakyWords = new Set();
  for (const w of activeTargets)
    if (storyTextLeaksWord(w.word, `${raw.title} ${raw.text}`)) leakyWords.add(V2.norm(w.word));
  if (leakyWords.size > 0) {
    if (attempt < 3) return generateStory(targetWords, selectedCategories, grammarRules, attempt + 1, leakyWords);
    const names = activeTargets.filter(w => leakyWords.has(V2.norm(w.word))).map(w => w.word).join(", ");
    throw new Error(`Story leaks target word(s) after ${attempt} attempts: ${names}`);
  }

  // ── vocab questions — match by targetWord content, not position ──
  if (raw.questions.length !== activeTargets.length)
    throw new Error(`Expected ${activeTargets.length} questions, received ${raw.questions.length}.`);
  const usedQIdx = new Set();
  const questions = activeTargets.map(target => {
    const qi = raw.questions.findIndex((q, i) => !usedQIdx.has(i) && q && typeof q.targetWord === "string" && V2.norm(q.targetWord) === V2.norm(target.word));
    if (qi === -1) throw new Error(`Missing a story question for: ${target.word}`);
    usedQIdx.add(qi);
    const q = raw.questions[qi];
    if (typeof q.prompt !== "string" || !q.prompt.trim()) throw new Error("Invalid story question — empty prompt.");
    for (const t of activeTargets)
      if (storyTextLeaksWord(t.word, q.prompt)) throw new Error(`Question leaks a target word: ${t.word}`);
    if (/which word means|what is the word for|which term means/i.test(q.prompt))
      throw new Error("A question uses a dictionary-style clue.");
    return { mode: "mcq", targetWord: q.targetWord, prompt: q.prompt.trim(), explanation: String(q.explanation || "").trim() || q.targetWord };
  });

  // ── grammar questions — drop individual failures, never reject the whole story ──
  const rawGQ = Array.isArray(raw.grammarQuestions) ? raw.grammarQuestions : [];
  const grammarQuestions = rawGQ.reduce((acc, g, index) => {
    try {
      if (!g || typeof g.promptSentence !== "string" || typeof g.answer !== "string" || !Array.isArray(g.options) || g.options.length < 2)
        throw new Error("bad shape");
      if ((g.promptSentence.match(/______/g) || []).length !== 1)
        throw new Error("not exactly one blank");
      if (!g.options.some(o => V2.norm(o) === V2.norm(g.answer)))
        throw new Error("answer not in options");
      if (!grammarSentenceIsGrounded(g.promptSentence, g.answer, raw.text))
        throw new Error("not grounded");
      acc.push({ id: `story-grammar:${Date.now()}:${index}`, mode: "grammarCourt", type: "mcq", prompt: g.promptSentence.trim(), answers: [g.answer], targets: [], options: g.options, explanation: String(g.explanation || "").trim() || `Grammar: ${grammarRules[index]?.rule || ""}` });
    } catch (e) {
      // log silently so the UI can see it, but keep the rest of the story
      console.warn(`Word Hunter: dropping grammar question [${index}] (${grammarRules[index]?.rule}): ${e.message}`);
    }
    return acc;
  }, []);

  const categories = [...new Set(selectedCategories.length ? selectedCategories : activeTargets.map(w => w.category))];
  return {
    id: `story-gen-${Date.now()}`,
    category: categories.length === 1 ? categories[0] : "Mixed Story",
    sourceCategories: categories,
    title: raw.title.trim(),
    text: raw.text.trim(),
    targetWords: activeTargets.map(w => w.word),
    questions,
    grammarQuestions,
  };
}

export async function evaluateFreeForm(question, answerText) {
  const kind = question.freeformKind || "sentence";
  const payload = {
    kind,
    targetWord: question.target?.word || question.target?.label,
    targetMeaning: question.target?.meaning || question.target?.explanation,
    situation: question.target?.situation || null,
    expectedAnswer: question.answer || null,
    learnerAnswer: answerText,
    rules: kind === "idiomMeaning"
      ? "Judge whether the learner correctly explains the idiom in this situation. The learner does not need to repeat the idiom itself."
      : kind === "grammarFix"
      ? "situation is a sentence with a grammar mistake and targetWord is the grammar rule it breaks. Judge whether the learner's sentence fixes that mistake correctly while keeping the same meaning. Any correct fix is fine; it does not have to match expectedAnswer. Set semanticUse to \"correct\" only when the mistake is fixed and no new error was added, and set targetWordUsed to true."
      : kind === "phrasalTransform"
      ? "The requested target phrasal verb should be used. A different valid equivalent may be acknowledged in feedback, but targetWordUsed must be false unless the requested target itself is present."
      : "Judge whether the target word is actually used with the intended meaning in a meaningful natural sentence; reject random word stuffing.",
  };
  const raw = await callClaudeJson(FREEFORM_EVALUATION_CONTRACT, payload);
  return validateEvaluation(raw, kind);
}

export async function evaluateAlternativeGap(question, answerText) {
  const raw = await callClaudeJson(`${FREEFORM_EVALUATION_CONTRACT}\nFor this task, targetWordUsed may be false. The learner typed a word that is not the intended one. Judge ONLY the sentence exactly as the learner saw it: the learner cannot know which vocabulary word the question was written for, so never reject an answer because it has a different meaning from intendedTarget. If the learner's word makes the gap sentence grammatically correct, natural and sensible (for example "elbow" in "He had surgery on his left ______."), set correct to true and semanticUse to "correct", even though it is a different word. Reject it only when the sentence becomes ungrammatical, unnatural or does not make sense. In feedback, say the answer fits and name the word the question was practising.`, {
    kind: "gapAlternative",
    sentenceWithGap: question.prompt,
    intendedTarget: question.answer,
    intendedMeaning: question.target?.meaning,
    learnerAnswer: answerText,
  });
  return validateEvaluation(raw, "gapAlternative");
}

// Called once a combo's current situation has been answered correctly
// twice (pool item locked) — writes a fresh example testing the SAME two
// target words so the underlying contrast keeps getting practiced with
// varied situations instead of repeating or just disappearing.
export async function generateComboVariant(combo) {
  const instructions = `Use B1-or-easier English. You write short "compare two things" exercise scenarios for an English vocabulary game. You are given two target words (a contrasting/opposite pair) and an existing situation+question. Write ONE brand-new situation testing the SAME two words with a DIFFERENT concrete example — same underlying contrast, fresh context, different characters/setting than the existing one. End with a short question asking the learner which word applies to which part. Do not use either target word inside the situation text itself. Respond with ONLY raw JSON, no markdown fences: {"situation":"...","prompt":"..."}`;
  const payload = { targetWords: combo.words, existingSituation: combo.situation, existingPrompt: combo.prompt, ruleExplanation: combo.explanation || "" };
  const raw = await callClaudeJson(instructions, payload, 500);
  const situation = String(raw?.situation || "").trim();
  const prompt = String(raw?.prompt || "").trim();
  if (!situation || !prompt) throw new Error("AI returned an incomplete combo variant.");
  if (combo.words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(situation))) throw new Error("AI variant leaked a target word into the situation.");
  return { situation, prompt };
}

// Same idea for a grammarCourt question — a fresh example of the same
// rule (not the same sentence pair forever) once the current one is mastered.
export async function generateGrammarVariant(g) {
  const instructions = `Use B1-or-easier English. You write short grammar-correction multiple-choice questions for an English vocabulary game. You are given an existing question testing one grammar rule (a common-mistake sentence and its correction). Write ONE brand-new example testing the SAME rule with different wording/context — not the same sentence reworded slightly. Respond with ONLY raw JSON, no markdown fences: {"prompt":"...","options":["<wrong sentence>","<correct sentence>"],"answer":"<must exactly match the correct sentence in options>","explanation":"one short sentence on why"}`;
  const payload = { existingPrompt: g.prompt, existingOptions: g.options, existingAnswer: g.answer, existingExplanation: g.explanation || "" };
  const raw = await callClaudeJson(instructions, payload, 500);
  const prompt = String(raw?.prompt || "").trim();
  const options = Array.isArray(raw?.options) ? raw.options.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const answer = String(raw?.answer || "").trim();
  const explanation = String(raw?.explanation || "").trim();
  if (!prompt || options.length < 2 || !answer || !options.includes(answer)) throw new Error("AI returned an incomplete grammar variant.");
  return { prompt, options, answer, explanation };
}

export async function evaluateFinalReport(words, reportText) {
  const raw = await callClaudeJson(`Use B1-or-easier explanations. You are a conservative English-learning evaluator for Word Hunter's FINAL CASE. Return ONLY JSON. Evaluate each evidence word separately for genuine semantic use; string presence alone is not enough. Minor grammar errors are allowed when meaning remains clear. Do not automatically pass all words.
Required shape:
{"confidence":"high|medium|low","understandable":true,"quality":"Strong Evidence|Good Evidence|Almost|Needs Work","words":[{"word":"...","used":true,"semanticUse":"correct|partly_correct|incorrect","productionSuccess":true,"feedback":"brief"}],"feedback":"one concise improvement suggestion"}`, {
    evidenceWords: words.map((w) => ({ word: w.word, meaning: w.meaning })),
    report: reportText,
  }, 1200);
  if (!raw || !Array.isArray(raw.words)) throw new Error("Invalid final report evaluation");
  const byWord = new Map(raw.words.map((x) => [String(x.word || "").toLowerCase(), x]));
  const evaluatedWords = words.map((w) => {
    const item = byWord.get(w.word.toLowerCase()) || {};
    const semanticUse = ["correct", "partly_correct", "incorrect"].includes(item.semanticUse) ? item.semanticUse : "incorrect";
    return {
      word: w.word,
      used: item.used === true,
      semanticUse,
      productionSuccess: item.productionSuccess === true && item.used === true && semanticUse === "correct",
      feedback: String(item.feedback || "").slice(0, 180),
    };
  });
  return {
    confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low",
    understandable: raw.understandable === true,
    quality: ["Strong Evidence", "Good Evidence", "Almost", "Needs Work"].includes(raw.quality) ? raw.quality : "Needs Work",
    words: evaluatedWords,
    feedback: String(raw.feedback || "").slice(0, 260),
  };
}

export function normalizeAnswerText(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

export function containsRequiredTerm(text, term) {
  const clean = (value) => normalizeAnswerText(value).replace(/[^a-z0-9']+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = clean(text);
  const needle = clean(term);
  return !!needle && ` ${haystack} `.includes(` ${needle} `);
}

export function spellingDistanceInfo(guess, expected) {
  const a = normalizeAnswerText(guess);
  const b = normalizeAnswerText(expected);
  const distance = levenshtein(a, b);
  const compactLength = Math.max(a.replace(/\s/g, "").length, b.replace(/\s/g, "").length);
  const maxMinor = compactLength <= 4 ? 1 : compactLength <= 8 ? 2 : 3;
  const close = a !== b && distance > 0 && distance <= maxMinor && distance / Math.max(1, compactLength) <= 0.28;
  return { distance, close, exact: a === b };
}

export async function evaluateGrammarCorrection(question, correction) {
  const raw = await callClaudeJson(`You are the judge in Word Hunter's GRAMMAR COURT. Return ONLY JSON: {"correct":true,"confidence":"high|medium|low","feedback":"brief","suggestedCorrection":"optional"}. Accept any grammatically correct correction that fixes the relevant rule; do not require an exact string. Be conservative when the learner changes the sentence so much that the target rule is no longer being demonstrated.`, {
    rule: question.target?.label,
    explanation: question.target?.explanation,
    evidence: question.prompt,
    expectedVerdict: question.answer,
    learnerCorrection: correction,
  });
  return {
    correct: raw?.correct === true && (raw?.confidence === "high" || raw?.confidence === "medium"),
    confidence: ["high","medium","low"].includes(raw?.confidence) ? raw.confidence : "low",
    feedback: String(raw?.feedback || "").slice(0, 240),
    suggestedCorrection: String(raw?.suggestedCorrection || "").slice(0, 240),
  };
}

export function buildContrastiveFeedback(question, selectedValue) {
  if (!question || !selectedValue || selectedValue === question.answer) return null;
  const selectedWord = findWordByLabel(selectedValue);
  const correctWord = findWordByLabel(question.answer) || question.target;
  if (!selectedWord || !correctWord?.meaning) return null;
  const relation = semanticRelation(correctWord, selectedWord);
  const selectedMeaning = String(selectedWord.meaning || "").replace(/\s+/g, " ").trim();
  const correctMeaning = String(correctWord.meaning || correctWord.explanation || "").replace(/\s+/g, " ").trim();
  return {
    chosen: selectedWord.word,
    correct: correctWord.word,
    chosenMeaning: selectedMeaning,
    correctMeaning,
    keyDifference: relation === "antonym"
      ? `${correctWord.word} and ${selectedWord.word} express opposite ideas.`
      : `${correctWord.word} fits this evidence; ${selectedWord.word} means ${selectedMeaning.charAt(0).toLowerCase()}${selectedMeaning.slice(1)}.`,
  };
}

// Real-time, situation-grounded version of the "Key difference" line above.
// The static version only contrasts dictionary meanings; this asks Claude to
// explain specifically why the CORRECT word fits *this* evidence/situation
// and why the chosen one doesn't, which is what was actually unclear.
export async function explainWrongLead(question, chosenWord, correctWord) {
  const raw = await callClaudeJson(
    `You are writing one short "why is this wrong" line inside an English vocabulary game called Word Hunter. The learner picked the wrong multiple-choice word for a piece of evidence (a situation or gap sentence). Explain, in ONE concrete sentence (max ~25 words), why the CORRECT word fits THIS SPECIFIC evidence and why the CHOSEN word doesn't — ground it in the situation, don't just restate two dictionary definitions. Return ONLY JSON: {"keyDifference":"one sentence"}`,
    {
      evidence: question.target?.situation || question.prompt || null,
      chosenWord: chosenWord.word,
      chosenMeaning: chosenWord.meaning || chosenWord.explanation || null,
      correctWord: correctWord.word,
      correctMeaning: correctWord.meaning || correctWord.explanation || null,
    },
    200
  );
  const text = String(raw?.keyDifference || "").trim();
  return text ? text.slice(0, 240) : null;
}
