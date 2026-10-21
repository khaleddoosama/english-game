import { V2 } from "./v2";
import { CHALLENGE_MODE_META, DISABLED_MODES, MASTERY_STAGE, RUNTIME_DISABLED_MODES, confusionCount, getMasteryStage, getProductionCorrect, normalizeMasteryRecord } from "./data";
import { normalizeAnswerText } from "./text";
/* --------------------------------- HELPERS --------------------------------- */

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Words too common to signal any real similarity between two definitions.
const MEANING_STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","that","this","is","are","was","were","be","been",
  "someone","something","somebody","people","person","you","your","yours","they","them","their","it","its",
  "who","whom","which","when","where","what","how","not","no","but","from","by","at","as","if","than","then",
  "very","more","most","less","least","much","many","other","others","own","same","such","about","into","over",
  "used","use","using","make","makes","making","made","do","does","doing","done","get","gets","getting","got",
  "have","has","had","can","could","will","would","should","may","might","must","one","two","also","often",
  "usually","especially","without","because","while","during","after","before","way","ways","thing","things",
]);

function meaningTokens(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3 && !MEANING_STOPWORDS.has(t))
  );
}

// Rough semantic closeness: how much two definitions overlap in meaningful
// words, normalized so short definitions aren't unfairly penalized.
function meaningSimilarity(a, b) {
  const ta = meaningTokens(a);
  const tb = meaningTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  return shared / Math.min(ta.size, tb.size);
}

// Picks the wrong answers. Two things make a distractor good: it should look
// like the same KIND of thing (an idiom among idioms, not among adjectives),
// and it should be close enough in MEANING that the choice actually tests
// understanding rather than being obvious at a glance. So: filter by type
// and category first, then rank what's left by definition overlap and pick
// from the closest handful — with a little randomness so repeat encounters
// aren't identical.
function sampleDistractors(content, target, n = 3) {
  return V2.optionWords([target], content.words, n + 1).filter(w => w.word !== target.word);
}

const OPPOSITE_TRAP_RATE = 0.12;

function weightedChoice(items) {
  const valid = items.filter((item) => item && item.weight > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of valid) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return valid[valid.length - 1].value;
}

function isPhrasal(word) {
  return word?.type === "phrasal" || (/^[a-z]+\s+(up|down|in|out|on|off|over|away|back|through|into|for|with|at|by|around|along|across)$/i.test(String(word?.word || "")));
}

function isIdiom(word) {
  return word?.type === "idiom" || word?.type === "binomial" || word?.type === "fyi";
}

function challengeType(challenge) {
  const raw = String(challenge?.type || "").trim();
  const aliases = {
    "idiom-story": "idiomStory",
    advancedIdiomStory: "idiomStory",
    "reverse-idiom-story": "reverseIdiomStory",
    "reverse-impostor": "reverseImpostor",
    "phrasal-transform": "phrasalTransform",
    "grammar-court": "grammarCourt",
  };
  return aliases[raw] || raw || "story";
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const key = normalizeAnswerText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function challengeLinkedWords(content, challenge) {
  const valid = new Set(content.words.map((w) => w.word));
  return uniqueStrings(challenge?.linkedWords).filter((word) => valid.has(word));
}

function authoredChallengesForWord(content, word, type = null) {
  return content.challenges.filter((challenge) => {
    if (!challenge || !challenge.id) return false;
    if (type && challengeType(challenge) !== type) return false;
    return challengeLinkedWords(content, challenge).includes(word.word);
  });
}

// The situation is the word's example sentence, so it normally contains the
// word. True when `text` (the situation by default) contains the word.
export function situationLeaks(word, text = word?.situation) {
  const answer = normalizeAnswerText(V2.bareWord(word?.word));
  return !!answer && normalizeAnswerText(text).includes(answer);
}

// A sentence that points to the word without showing it, for questions
// that ask "which word?": the gap sentence (word blanked out), or an older
// scenario-style situation that never used the word. Null if neither works.
function contextSentence(word) {
  if (word?.gap && /_{2,}/.test(word.gap) && !situationLeaks(word, word.gap)) return word.gap;
  if (word?.situation && !situationLeaks(word)) return word.situation;
  return null;
}

function isStrongStoryFallback(word) {
  const situation = String(word?.situation || "").trim();
  const sentences = situation.split(/(?<=[.!?])\s+/).filter(Boolean);
  const leaksAnswer = normalizeAnswerText(situation).includes(normalizeAnswerText(word?.word));
  return !leaksAnswer && sentences.length >= 2 && sentences.length <= 4 && situation.split(/\s+/).length >= 18;
}

function buildChallengeQuestionUnsafe(content, challenge) {
  const type = challengeType(challenge);
  const linkedWords = challengeLinkedWords(content, challenge);
  const answerList = uniqueStrings(challenge.answers);
  const acceptedAnswers = uniqueStrings([
    ...(challenge.answer !== undefined ? [challenge.answer] : []),
    ...answerList,
    ...(Array.isArray(challenge.acceptedAnswers) ? challenge.acceptedAnswers : []),
  ]);
  const answer = challenge.answer ?? acceptedAnswers[0] ?? "";
  const target = {
    ...challenge,
    key: `challenge:${challenge.id}`,
    label: String(challenge.label || answer || CHALLENGE_MODE_META[type]?.label || "Challenge"),
    explanation: String(challenge.explanation || ""),
  };
  const common = {
    target,
    challengeId: challenge.id,
    linkedWords,
    modeId: type,
    difficulty: Math.max(1, Number(challenge.difficulty || 1)),
    prompt: String(challenge.prompt || ""),
    answer,
    acceptedAnswers,
    explanation: target.explanation,
  };

  if (Array.isArray(challenge.steps) && challenge.steps.length) {
    const steps = challenge.steps.map((step, index) => ({
      ...step,
      id: step.id || `${challenge.id}-step-${index + 1}`,
      type: step.type === "typing" ? "typing" : "mcq",
      options: uniqueStrings(step.options),
      acceptedAnswers: uniqueStrings([
        ...(step.answer !== undefined ? [step.answer] : []),
        ...(Array.isArray(step.answers) ? step.answers : []),
        ...(Array.isArray(step.acceptedAnswers) ? step.acceptedAnswers : []),
      ]),
    }));
    return { ...common, type: "multiStage", steps, court: type === "grammarCourt" };
  }

  const interaction = challenge.interaction || challenge.variant;
  if (interaction === "selfCheck" || interaction === "freeSentence") {
    return {
      ...common,
      type: "selfCheck",
      requiredWords: uniqueStrings(challenge.requiredWords?.length ? challenge.requiredWords : linkedWords),
      exampleAnswer: String(challenge.exampleAnswer || answer || ""),
    };
  }
  if (interaction === "typing" || (!challenge.options && acceptedAnswers.length)) {
    return { ...common, type: "typing" };
  }
  const options = uniqueStrings(challenge.options);
  if (answerList.length > 1) {
    return { ...common, type: "multi", options, correctAnswers: answerList };
  }
  return { ...common, type: "mcq", options, answer };
}

export function getAllowedModes(content, word) {
  const base = ["meaning", "gap", "gapTyping", "situation", "typing"];
  if (isStrongStoryFallback(word)) base.push("story");
  if (word?.opposite || Math.random() < OPPOSITE_TRAP_RATE) base.push("opposite");
  if (canBuildWhoAmI(word)) base.push("whoami");
  if (canBuildTwoPerson(content, word)) base.push("twopeople", "selecttwo");
  if (isIdiom(word)) base.push("idiomDetective");
  if (["phrasal", "fyi"].includes(word?.type) && word?.transformExample) base.push("phrasalTransform");
  if (word?.skipTyping) return base.filter((m) => !["typing", "gapTyping", "phrasalTransform"].includes(m));
  return [...new Set(base)].filter((m) => !DISABLED_MODES.has(m) && !RUNTIME_DISABLED_MODES.has(m));
}

export function getStrongConfusion(word, confusions = {}) {
  const prefix = `${word.word}|`;
  return Object.entries(confusions)
    .filter(([key, value]) => key.startsWith(prefix) && confusionCount(value) >= 2)
    .map(([key, value]) => ({ partner: key.slice(prefix.length), count: confusionCount(value), lastAt: Number(value?.lastAt || 0) }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)[0] || null;
}

export function selectAdaptiveMode(content, word, masteryStats, context = {}) {
  const stats = normalizeMasteryRecord(masteryStats);
  const stage = getMasteryStage(stats, { kind: "word", obj: word });
  const allowed = new Set(getAllowedModes(content, word));
  const confusion = context.confusion || null;
  const hasProduction = getProductionCorrect(stats) > 0;
  const weakModes = Object.entries(stats.modes)
    .filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65)
    .map(([modeId]) => modeId);

  const baseByStage = {
    New: { meaning: 8, situation: 7, gap: 6, story: 0, whoami: 2, opposite: 1, impostor: 0, typing: 0, gapTyping: 0 },
    Familiar: { meaning: 4, situation: 5, gap: 5, story: 4, whoami: 3, opposite: 3, impostor: 0, twopeople: 1.5, selecttwo: 1.5, typing: 1.5, gapTyping: 1.5 },
    Learned: { meaning: 1.2, situation: 3, gap: 2, story: 4, whoami: 1.5, opposite: 2, impostor: 4, twopeople: 1, selecttwo: 1, typing: 6, gapTyping: 6 },
    Mastered: { meaning: 0.4, situation: 1, gap: 0.8, story: 2, opposite: 2, impostor: 5, typing: 2.5, gapTyping: 2.5 },
  };
  const base = { ...(baseByStage[stage] || baseByStage.New) };
  if (isPhrasal(word)) base.phrasalTransform = stage === MASTERY_STAGE.NEW ? 0.3 : stage === MASTERY_STAGE.FAMILIAR ? 2 : 5;
  if (isIdiom(word)) base.idiomDetective = stage === MASTERY_STAGE.NEW ? 3 : 5;

  weakModes.forEach((modeId) => { base[modeId] = (base[modeId] || 0) + 7; });
  if (stats.spellingMisses > 0) {
    base.typing = (base.typing || 0) + Math.min(8, stats.spellingMisses * 2);
    base.gapTyping = (base.gapTyping || 0) + Math.min(6, stats.spellingMisses * 1.5);
  }
  if (!hasProduction && (stage === MASTERY_STAGE.LEARNED || stage === MASTERY_STAGE.FAMILIAR)) {
    base.typing = (base.typing || 0) + 4;
    base.gapTyping = (base.gapTyping || 0) + 3;
  }
  if (confusion) {
    base.meaning = (base.meaning || 0) + 4;
    base.impostor = (base.impostor || 0) + 5;
    base.situation = (base.situation || 0) + 3;
  }
  if (stage === MASTERY_STAGE.MASTERED && !context.forceMastered) {
    Object.keys(base).forEach((k) => { base[k] *= 0.35; });
  }
  if (context.lastMode && base[context.lastMode] && !weakModes.includes(context.lastMode)) base[context.lastMode] *= 0.25;
  const weighted = Object.entries(base)
    .filter(([modeId]) => allowed.has(modeId) && !(context.quarantine && context.quarantine.has(`${String(word.word||"").trim().toLowerCase()}|${modeId}`)))
    .map(([value, weight]) => ({ value, weight }));
  return weightedChoice(weighted) || (allowed.has("situation") ? "situation" : [...allowed][0] || "meaning");
}

/* --------------------------------- POOLS ----------------------------------- */
// Each word keeps independent, rotating content pools per question type
// (meaning / gap / situation / typing). Once a variant has been answered
// correctly twice, it locks for a week and a fresh one is generated so the
// same phrasing never gets memorized instead of the word itself.

const POOL_TYPES = ["meaning", "gap", "situation", "typing"];
export const LOCK_DAYS = 7;

export function getWordPools(pools, word) {
  const existing = pools[word.word] || {};
  const current = { ...existing };
  for (const type of POOL_TYPES) current[type] = V2.poolItems(word, type, existing[type]);
  return current;
}

function pickActiveItem(wordPools, poolType) {
  const arr = wordPools[poolType];
  const now = Date.now();
  const unlocked = arr.filter((it) => !it.lockedUntil || it.lockedUntil <= now);
  const candidates = unlocked.length ? unlocked : arr;
  return candidates.reduce((a, b) => (a.attempts <= b.attempts ? a : b));
}

function poolHasFreshItem(wordPools, poolType) {
  const now = Date.now();
  return wordPools[poolType].some((it) => !it.lockedUntil || it.lockedUntil <= now);
}

export function poolNeedsGeneration(wordPools, poolType) {
  return !poolHasFreshItem(wordPools, poolType);
}

// When a word's pool for the chosen style is exhausted (everything answered
// right twice and no replacement generated yet), repeating that exact
// question is the worst option — it's the same text a third time. Swap to
// another style for this word that still has unseen content instead.
function resolvePoolMode(modeId, wordObj, wordPools) {
  if (poolHasFreshItem(wordPools, modeId)) return modeId;
  const alternatives = POOL_TYPES.filter(
    (pt) => pt !== modeId && !(pt === "typing" && wordObj.skipTyping) && poolHasFreshItem(wordPools, pt)
  );
  if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  return modeId; // genuinely nothing fresh anywhere — fall back to reuse
}

// --- Opposite Battle: four sub-modes, all built from data we already have ---

// True when a and b are opposites through either word's antonyms
// (Good is the opposite of both Sick and Ill).
function areOpposites(a, b) {
  if (!a || !b) return false;
  const has = (x, y) => x.opposite === y.word || V2.antonymsOf(x).some((t) => V2.norm(V2.bareWord(t)) === V2.norm(V2.bareWord(y.word)));
  return has(a, b) || has(b, a);
}
// A wrong option for "opposite of X" must not be another opposite of X, or
// clash with the right answer (synonym / never-together).
function safeOppositeDistractor(wordObj, answerObj, d) {
  return d.word !== wordObj.word && d.word !== answerObj?.word && !areOpposites(wordObj, d) && (!answerObj || V2.compatible(answerObj, d));
}
// Mode A — direct match: word shown, pick its opposite from 4 options.
function buildOppositeDirect(content, wordObj) {
  const answerObj = findWordByLabel(content, wordObj.opposite);
  const distractors = sampleDistractors(content, wordObj, 5).filter((d) => safeOppositeDistractor(wordObj, answerObj, d)).slice(0, 3);
  while (distractors.length < 3) {
    const extra = shuffle(content.words.filter((w) => safeOppositeDistractor(wordObj, answerObj, w) && !distractors.includes(w)))[0];
    if (!extra) break;
    distractors.push(extra);
  }
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: `${wordObj.word} ↔ ${wordObj.opposite}` };
  const options = shuffle([wordObj.opposite, ...distractors.slice(0, 3).map((d) => d.word)]);
  return { target, prompt: wordObj.word, options, answer: wordObj.opposite, type: "mcq" };
}

// Mode B — pick the side of the sentence: the word's gap sentence (written
// for the word, not its opposite) becomes a two-option choice between the
// word and its opposite.
function buildOppositeSentence(content, wordObj) {
  const context = contextSentence(wordObj);
  if (!context) return buildOppositeDirect(content, wordObj);
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: `${wordObj.word} ↔ ${wordObj.opposite}` };
  const options = shuffle([wordObj.word, wordObj.opposite]);
  return { target, prompt: context, options, answer: wordObj.word, type: "mcq" };
}

// Mode C — "Opposite or not?": two words, judge whether they're a real pair.
// True half the time (the real opposite); false half the time (a plausible
// but wrong same-category word), so "No" isn't just the safe guess.
function buildOppositePairJudgment(content, wordObj) {
  const isTruePair = Math.random() < 0.5;
  let partner;
  if (isTruePair) {
    partner = wordObj.opposite;
  } else {
    const sameGroup = content.words.filter(
      (w) => w.word !== wordObj.word && !areOpposites(wordObj, w) && w.category === wordObj.category && w.type === wordObj.type
    );
    const pool = sameGroup.length ? sameGroup : content.words.filter((w) => w.word !== wordObj.word && !areOpposites(wordObj, w));
    partner = shuffle(pool)[0]?.word;
  }
  if (!partner) return buildOppositeDirect(content, wordObj);
  const answer = isTruePair ? "Yes, opposites" : "No, not opposites";
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: answer,
    explanation: isTruePair ? `${wordObj.word} ↔ ${partner}` : `${wordObj.word} and ${partner} aren't opposites.`,
  };
  return {
    target,
    prompt: `${wordObj.word}  ⚔️  ${partner}`,
    options: ["Yes, opposites", "No, not opposites"],
    answer,
    type: "mcq",
  };
}

// Mode E — the trap: not every word has a clean opposite, and knowing that
// is part of the skill. Only ever used for words with no `opposite` field.
function buildOppositeTrap(content, wordObj) {
  const distractors = sampleDistractors(content, wordObj, 3);
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: "No clear opposite",
    explanation: `${wordObj.word} doesn't have one clear, well-known opposite in this set.`,
  };
  const options = shuffle(["No clear opposite", ...distractors.map((d) => d.word)]);
  return { target, prompt: wordObj.word, options, answer: "No clear opposite", type: "mcq" };
}

function buildOppositeQuestion(content, wordObj) {
  if (!wordObj.opposite) return buildOppositeTrap(content, wordObj);
  const r = Math.random();
  if (r < 0.34) return buildOppositeDirect(content, wordObj);
  if (r < 0.67) return buildOppositeSentence(content, wordObj);
  return buildOppositePairJudgment(content, wordObj);
}

// --- Who Am I? — the word narrates its own meaning in first person. ---
// Only meanings phrased as a description ("Unable to make decisions...")
// convert cleanly; verb-style ones ("To deliberately say or do...") read
// oddly in first person, so those words simply don't get this mode.
export function firstPersonify(meaning) {
  if (!meaning) return null;
  let m = meaning.trim();
  if (/^(to\s|an?\s|the\s|someone\b|something\b|used to say\b)/i.test(m)) return null;
  m = m.replace(/[.!?\s]+$/, "").replace(/\s*\([^)]*\)$/, "").replace(/[.!?\s]+$/, "");
  if (!m) return null;
  return `I'm ${m.charAt(0).toLowerCase()}${m.slice(1)}.`;
}

export function canBuildWhoAmI(w) {
  return w?.type === "vocab" && firstPersonify(w.meaning) !== null;
}

function buildWhoAmIQuestion(content, wordObj) {
  const riddle = firstPersonify(wordObj.meaning);
  const distractors = sampleDistractors(content, wordObj, 3);
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  const options = shuffle([wordObj.word, ...distractors.map((d) => d.word)]);
  return { target, prompt: `${riddle} Who am I?`, options, answer: wordObj.word, type: "mcq" };
}

// --- Two People / Select Two — combine two context sentences (usually the
// gap sentences) into one harder question, without needing new authored
// content. A "companion" word from the same category supplies the second.
// `ctx` picks the sentence for a word (default: its first gap sentence);
// practice passes one that returns only sentences the learner hasn't seen.
function pickCompanion(content, wordObj, ctx = contextSentence) {
  const source = normalizeAnswerText(ctx(wordObj));
  const pool = content.words.filter((w) =>
    w.word !== wordObj.word &&
    w.category === wordObj.category &&
    ctx(w) &&
    normalizeAnswerText(ctx(w)) !== source &&
    !situationLeaks(wordObj, ctx(w)) &&
    meaningSimilarity(w.meaning, wordObj.meaning) < 0.55
  );
  return pool.length ? shuffle(pool)[0] : null;
}

function canBuildTwoPerson(content, wordObj) {
  return !!contextSentence(wordObj) && pickCompanion(content, wordObj) !== null;
}

function fillToFour(content, base, exclude) {
  const options = [...base];
  if (options.length >= 4) return options.slice(0, 4);
  const more = shuffle(content.words.filter((w) => !exclude.has(w.word) && !options.includes(w.word)));
  for (const w of more) {
    if (options.length >= 4) break;
    options.push(w.word);
  }
  return options;
}

export function buildTwoPeopleQuestion(content, wordObj, ctx = contextSentence) {
  const mine = ctx(wordObj);
  const companion = mine ? pickCompanion(content, wordObj, ctx) : null;
  if (!companion) return null;
  const theirs = ctx(companion);
  const askFirst = Math.random() < 0.5;
  const distractors = sampleDistractors(content, wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour(content, [wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
  const prompt = askFirst
    ? `Person A: "${mine}"\n\nPerson B: "${theirs}"\n\nWhich word belongs to Person A?`
    : `Person A: "${theirs}"\n\nPerson B: "${mine}"\n\nWhich word belongs to Person B?`;
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  return { target, prompt, options, answer: wordObj.word, type: "mcq", sentences: [mine, theirs] };
}

export function buildSelectTwoQuestion(content, wordObj, ctx = contextSentence) {
  const mine = ctx(wordObj);
  const companion = mine ? pickCompanion(content, wordObj, ctx) : null;
  if (!companion) return null;
  const distractors = sampleDistractors(content, wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour(content, [wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: `${wordObj.word} & ${companion.word}`,
    explanation: `"${wordObj.situation}" → ${wordObj.word}. "${companion.situation}" → ${companion.word}.`,
  };
  return {
    target,
    prompt: `Two sentences — pick the two words that fit:\n\n1) ${mine}\n\n2) ${ctx(companion)}`,
    sentences: [mine, ctx(companion)],
    options,
    correctAnswers: [wordObj.word, companion.word],
    type: "multi",
  };
}

export const SPEED_SECONDS = 60, SPEED_QUEUE_SIZE = 80;
// The legacy speed builder's shape → a SessionView question.
export function speedQuestionV2(raw, i) {
  const w = raw.target;
  return { id: `speed:${i}:${w.word}`, mode: raw.prompt === w.gap ? "gap" : "reverse", type: "mcq", prompt: raw.prompt, options: raw.options, answers: [w.word], targets: [w.word], explanation: w.meaning, hints: [] };
}
// Points: 10 per correct answer plus a combo bonus (2 per answer in a row, up to 10).
export function speedStats(answers = []) {
  let points = 0, correct = 0, answered = 0, combo = 0, bestCombo = 0;
  for (const a of answers) {
    if (!a) continue;
    answered++;
    if (a.correct) { correct++; combo++; bestCombo = Math.max(bestCombo, combo); points += 10 + Math.min(combo, 5) * 2; } else combo = 0;
  }
  return { points, correct, answered, combo, bestCombo };
}
export function buildSpeedQuestion(content, pool) {
  for(const w of shuffle(pool)) {
    const choices=V2.optionWords([w],content.words,4).map(x=>x.word);
    const prompts=[w.meaning,...(/_{2,}/.test(w.gap)?[w.gap]:[])].filter(text=>text&&text.length<=180&&!V2.norm(text).includes(V2.norm(w.word)));
    if(choices.length>=2&&prompts.length)return {target:{...w,key:w.word,label:w.word},prompt:shuffle(prompts)[0],options:choices,answer:w.word,type:"mcq"};
  }
  return null;
}


export function findWordByLabel(content, label) {
  const key = String(label || "").trim().toLowerCase();
  return content.words.find((w) => String(w.word || "").trim().toLowerCase() === key) || null;
}

function hardDistractors(content, target, count = 3) { return sampleDistractors(content, target, count); }

function buildImpostorQuestion(content, wordObj, _difficulty = 2) {
  const authored = authoredChallengesForWord(content, wordObj, "impostor");
  if (!authored.length) return null;
  return buildChallengeQuestion(content, shuffle(authored)[0]);
}

function safeLegacyQuestion(content, q) {
  if (!q) return q;
  const lists = [q.options, ...(q.steps || []).map(step => step.options)].filter(Array.isArray);
  let invalid = false;
  for (const list of lists) {
    if (list.length < 2 || new Set(list.map(V2.norm)).size !== list.length) invalid = true;
    const refs = list.map(label => content.words.find(w => V2.norm(w.word) === V2.norm(label) || V2.norm(w.meaning) === V2.norm(label))).filter(Boolean);
    if (refs.some((w, i) => refs.slice(i + 1).some(other => !V2.compatible(w, other)))) invalid = true;
  }
  return invalid ? { ...q, type: "unavailable", prompt: "This authored question conflicts with option exclusions or has too few unique options. Report it or continue; no mastery credit is awarded." } : q;
}
export function buildQuestion(content, ...args) { return safeLegacyQuestion(content, buildQuestionUnsafe(content, ...args)); }
function buildChallengeQuestion(content, ...args) { return safeLegacyQuestion(content, buildChallengeQuestionUnsafe(content, ...args)); }

function buildQuestionUnsafe(content, modeId, wordObj, pools, options = {}) {
  const difficulty = Math.max(1, Number(options.difficulty || 1));
  const confusionPartner = options.confusionPartner || null;
  if (modeId === "opposite") return { ...buildOppositeQuestion(content, wordObj), modeId, difficulty };
  if (modeId === "whoami") return { ...buildWhoAmIQuestion(content, wordObj), modeId, difficulty };
  if (modeId === "twopeople") return { ...(buildTwoPeopleQuestion(content, wordObj) || buildQuestion(content, "situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "selecttwo") return { ...(buildSelectTwoQuestion(content, wordObj) || buildQuestion(content, "situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "impostor") return buildImpostorQuestion(content, wordObj, difficulty) || buildQuestion(content, "situation", wordObj, pools, { ...options, difficulty: Math.min(2, difficulty) });

  if (modeId === "story") {
    const authored = authoredChallengesForWord(content, wordObj, "story");
    if (authored.length) return buildChallengeQuestion(content, shuffle(authored)[0]);
    if (isStrongStoryFallback(wordObj)) {
      const distractors = hardDistractors(content, wordObj, 3, confusionPartner);
      const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
      return {
        target,
        modeId: "story",
        difficulty,
        type: "mcq",
        prompt: `${wordObj.situation}\n\nWhich word best describes the complete story?`,
        options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]),
        answer: wordObj.word,
      };
    }
    return buildQuestion(content, "situation", wordObj, pools, options);
  }

  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  if (modeId === "phrasalTransform" && ["phrasal", "fyi"].includes(wordObj.type) && wordObj.transformExample) {
    return { target, modeId, difficulty, type: "typing", prompt: `Use “${wordObj.word}”: ${wordObj.transformExample.before}`, answer: wordObj.transformExample.after, acceptedAnswers: [wordObj.transformExample.after], modelOnly: true, freeformKind: "phrasalTransform" };
  }
  if (modeId === "phrasalTransform") {
    if (!isPhrasal(wordObj)) return buildQuestion(content, "gapTyping", wordObj, pools, options);
    const authored = authoredChallengesForWord(content, wordObj, "phrasalTransform");
    return authored.length ? buildChallengeQuestion(content, shuffle(authored)[0]) : buildQuestion(content, "gapTyping", wordObj, pools, options);
  }
  if (modeId === "idiomDetective") {
    if (!isIdiom(wordObj)) return buildQuestion(content, "situation", wordObj, pools, options);
    if (difficulty <= 2) {
      const context = contextSentence(wordObj);
      if (!context) return buildQuestion(content, "gap", wordObj, pools, options);
      const distractors = hardDistractors(content, wordObj, 3, confusionPartner);
      return { target, modeId, difficulty, type: "mcq", prompt: context, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word };
    }
    return { target, modeId, difficulty, type: "freeform", prompt: `In this situation, what does “${wordObj.word}” mean?\n${wordObj.situation}`, answer: wordObj.meaning, freeformKind: "idiomMeaning" };
  }

  const wordPools = getWordPools(pools, wordObj);
  let poolMode = modeId === "gapTyping" ? "gap" : modeId;
  if (!POOL_TYPES.includes(poolMode)) poolMode = "situation";
  poolMode = resolvePoolMode(poolMode, wordObj, wordPools);
  let activeItem = pickActiveItem(wordPools, poolMode);
  if (poolMode === "situation" && situationLeaks(wordObj, activeItem.text)) { poolMode = "gap"; activeItem = pickActiveItem(wordPools, "gap"); }
  const common = { target, modeId, difficulty, poolType: poolMode, poolItemId: activeItem.id };
  const distractors = difficulty >= 3 ? hardDistractors(content, wordObj, 3, confusionPartner) : sampleDistractors(content, wordObj, 3);

  if (modeId === "meaning" && difficulty >= 2) {
    const hard = difficulty >= 3 ? hardDistractors(content, wordObj, 3, confusionPartner) : distractors;
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...hard.map((d) => d.word)]), answer: wordObj.word, type: "mcq", direction: "meaningToWord" };
  }
  if (modeId === "meaning") {
    return { ...common, prompt: wordObj.word, options: shuffle([activeItem.text, ...distractors.map((d) => d.meaning)]), answer: activeItem.text, type: "mcq", direction: "wordToMeaning" };
  }
  if (modeId === "gap") {
    if (difficulty >= 3) {
      const first = difficulty === 3 ? `${wordObj.word.charAt(0)}${"_".repeat(Math.max(3, wordObj.word.length - 1))}` : null;
      return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing", hint: first, allowAlternativeGap: difficulty >= 5 };
    }
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word, type: "mcq" };
  }
  if (modeId === "gapTyping") {
    const first = difficulty <= 2 ? `${wordObj.word.charAt(0)}${"_".repeat(Math.max(3, wordObj.word.length - 1))}` : null;
    return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing", hint: first, allowAlternativeGap: difficulty >= 5 };
  }
  if (modeId === "situation") {
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word, type: "mcq" };
  }
  return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing" };
}
function buildGrammarQuestion(g) {
  const target = { ...g, key: `grammar:${g.id}`, label: g.rule, explanation: g.explanation };
  const q = V2.grammarQuestions(g).find((x) => x.type === "choose") || { prompt: g.prompt, options: g.options || [], answer: g.answer };
  return { target, modeId: "grammarCourt", prompt: q.prompt, options: shuffle(q.options), answer: q.answer, type: "mcq", court: true };
}

function buildEntryQuestion(content, entry, pools) {
  if (entry.kind === "word") return buildQuestion(content, entry.mode, entry.wordObj, pools, { difficulty: entry.difficulty, confusionPartner: entry.confusionPartner });
  if (entry.kind === "grammar") return buildGrammarQuestion(entry.obj);
  if (entry.kind === "challenge") return buildChallengeQuestion(content, entry.obj);
  return null;
}

// Adaptive builders remain question factories, but all questions are
// normalized into one V2 session/answer contract. There is no second runner.
export function legacyQuestionToV2(content, question, entry, idSuffix = "0") {
  if (!question) return [];
  const mode = question.modeId || (entry.kind === "challenge" ? challengeType(entry.obj) : entry.kind);
  const linkedWords = entry.kind === "word" ? [entry.wordObj.word] : entry.kind === "challenge" ? challengeLinkedWords(content, entry.obj) : [];
  const progressKeys = entry.kind === "word" ? linkedWords : entry.kind === "grammar" ? [`grammar:${entry.obj.id}`] : entry.kind === "pun" ? [`pun:${entry.obj.id}`] : [`challenge:${entry.obj.id}`, ...linkedWords];
  const base = { id:`v2:${entry.kind}:${entry.obj?.id||entry.wordObj?.word||idSuffix}:${idSuffix}`, mode, targets:linkedWords, progressKeys, prompt:question.prompt, explanation:question.explanation||question.target?.explanation||"", difficulty:question.difficulty||entry.difficulty||1, poolType:question.poolType, poolItemId:question.poolItemId, challengeId:question.challengeId };
  if (question.type === "multiStage") return question.steps.flatMap((step,index)=>legacyQuestionToV2(content, {...question,type:step.type,prompt:step.prompt,options:step.options,answer:step.acceptedAnswers?.[0],acceptedAnswers:step.acceptedAnswers,explanation:step.explanation||question.explanation,steps:undefined},entry,`${idSuffix}-step-${index+1}`));
  if (question.type === "unavailable") return [{...base,type:"mcq",options:["Skip this invalid question"],answers:["Skip this invalid question"],noMastery:true,noTelemetry:true}];
  if (question.type === "selfCheck") return [{...base,type:"typing",answers:[question.exampleAnswer||question.answer||""],objectiveTerms:question.requiredWords||linkedWords,noMastery:true}];
  if (question.type === "multi") return [{...base,type:"multi",options:question.options||[],answers:question.correctAnswers||question.acceptedAnswers||[]}];
  if (question.type === "freeform" || question.type === "typing") return [{...base,type:"typing",answers:question.acceptedAnswers?.length?question.acceptedAnswers:[question.answer],modelOnly:!!question.modelOnly||question.type==="freeform",freeformKind:question.freeformKind}];
  return [{...base,type:"mcq",options:question.options||[],answers:[question.answer]}];
}

const poolsSnapshotForSession = {};
export function v2SessionFromEntries(content, entries, {kind,title,idPrefix=kind}) {
  const queue=entries.flatMap((entry,index)=>legacyQuestionToV2(content, buildEntryQuestion(content, entry,poolsSnapshotForSession),entry,String(index)));
  return {id:`${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,kind,title,queue,introductions:[],index:0,answers:[],initialLength:queue.length};
}

