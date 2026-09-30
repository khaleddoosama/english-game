import { BookOpen, Scale, Sparkles } from "lucide-react";
import { V2 } from "./v2";
import { CHALLENGES, CHALLENGE_MODE_META, DISABLED_MODES, LAST_CHALLENGE_ID, MASTERY_STAGE, MASTERY_STAGE_RANK, MODE_META, RUNTIME_DISABLED_MODES, WORDS, confusionCount, dedupeBy, getMasteryStage, getProductionCorrect, levelItemKey, normalizeMasteryRecord } from "./data";
import { normalizeAnswerText } from "./ai";
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
export const MEANING_STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","that","this","is","are","was","were","be","been",
  "someone","something","somebody","people","person","you","your","yours","they","them","their","it","its",
  "who","whom","which","when","where","what","how","not","no","but","from","by","at","as","if","than","then",
  "very","more","most","less","least","much","many","other","others","own","same","such","about","into","over",
  "used","use","using","make","makes","making","made","do","does","doing","done","get","gets","getting","got",
  "have","has","had","can","could","will","would","should","may","might","must","one","two","also","often",
  "usually","especially","without","because","while","during","after","before","way","ways","thing","things",
]);

export function meaningTokens(text) {
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
export function meaningSimilarity(a, b) {
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
export function sampleDistractors(target, n = 3) {
  return V2.optionWords([target], WORDS, n + 1).filter(w => w.word !== target.word);
}

export function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

export const OPPOSITE_TRAP_RATE = 0.12;

export function weightedChoice(items) {
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

export function modeAccuracy(stats, modeId) {
  const mode = normalizeMasteryRecord(stats).modes[modeId];
  return mode?.total ? (mode.correct / mode.total) * 100 : null;
}

export function isPhrasal(word) {
  return word?.type === "phrasal" || (/^[a-z]+\s+(up|down|in|out|on|off|over|away|back|through|into|for|with|at|by|around|along|across)$/i.test(String(word?.word || "")));
}

export function isIdiom(word) {
  return word?.type === "idiom" || word?.type === "binomial" || word?.type === "fyi";
}

export function isStrictIdiom(word) {
  return word?.type === "idiom";
}

export function challengeType(challenge) {
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

export function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const key = normalizeAnswerText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function challengeLinkedWords(challenge) {
  const valid = new Set(WORDS.map((w) => w.word));
  return uniqueStrings(challenge?.linkedWords).filter((word) => valid.has(word));
}

export function authoredChallengesForWord(word, type = null) {
  return CHALLENGES.filter((challenge) => {
    if (!challenge || !challenge.id) return false;
    if (type && challengeType(challenge) !== type) return false;
    return challengeLinkedWords(challenge).includes(word.word);
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
export function contextSentence(word) {
  if (word?.gap && /_{2,}/.test(word.gap) && !situationLeaks(word, word.gap)) return word.gap;
  if (word?.situation && !situationLeaks(word)) return word.situation;
  return null;
}

export function isStrongStoryFallback(word) {
  const situation = String(word?.situation || "").trim();
  const sentences = situation.split(/(?<=[.!?])\s+/).filter(Boolean);
  const leaksAnswer = normalizeAnswerText(situation).includes(normalizeAnswerText(word?.word));
  return !leaksAnswer && sentences.length >= 2 && sentences.length <= 4 && situation.split(/\s+/).length >= 18;
}

export function challengeProgressEligible(challenge, mastery = {}) {
  const linked = challengeLinkedWords(challenge);
  if (!linked.length) return true;
  const stages = linked.map((word) => {
    const obj = WORDS.find((item) => item.word === word);
    return obj ? MASTERY_STAGE_RANK[getMasteryStage(mastery[word], { kind: "word", obj })] : 0;
  });
  const type = challengeType(challenge);
  const production = type === "phrasalTransform";
  const threshold = production && Number(challenge.difficulty || 1) >= 3
    ? MASTERY_STAGE_RANK[MASTERY_STAGE.LEARNED]
    : MASTERY_STAGE_RANK[MASTERY_STAGE.FAMILIAR];
  return stages.every((stage) => stage >= threshold);
}

export function buildChallengeQuestionUnsafe(challenge) {
  const type = challengeType(challenge);
  const linkedWords = challengeLinkedWords(challenge);
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

export function challengeValidationIssues(challenge, wordSource = WORDS) {
  const issues = [];
  if (!challenge || typeof challenge !== "object") return ["challenge must be an object"];
  if (!String(challenge.id || "").trim()) issues.push("missing stable id");
  if (!String(challenge.prompt || "").trim()) issues.push("missing prompt");
  const type = challengeType(challenge);
  const options = uniqueStrings(challenge.options);
  const answers = uniqueStrings([
    ...(challenge.answer !== undefined ? [challenge.answer] : []),
    ...(Array.isArray(challenge.answers) ? challenge.answers : []),
  ]);
  if (Array.isArray(challenge.options) && options.length !== challenge.options.length) issues.push("duplicate or blank options");
  if (options.length && answers.some((answer) => !options.some((option) => normalizeAnswerText(option) === normalizeAnswerText(answer)))) issues.push("answer is missing from options");
  if (["story", "idiomStory", "reverseIdiomStory", "impostor", "reverseImpostor"].includes(type) && options.length !== 4) issues.push(`${type} requires four unique options`);
  if ((type === "story" || type === "idiomStory") && challenge.answer && normalizeAnswerText(challenge.prompt).includes(normalizeAnswerText(challenge.answer))) issues.push("prompt leaks the answer");
  if ((type === "impostor" || type === "reverseImpostor") && !challenge.relationship) issues.push("impostor relationship is not stored");
  if (type === "impostor" && options.length !== 4) issues.push("impostor requires four options");
  if (type === "reverseImpostor" && options.length !== 4) issues.push("reverse impostor requires four options");
  if (type === "idiomStory") {
    const optionWords = options.map((option) => wordSource.find((word) => normalizeAnswerText(word.word) === normalizeAnswerText(option)));
    if (options.length && optionWords.some((word) => !isStrictIdiom(word))) issues.push("idiom challenge options must all be loaded idioms");
  }
  if (type === "idiomStory" || type === "reverseIdiomStory") {
    const linked = uniqueStrings(challenge.linkedWords).map((label) => wordSource.find((word) => word.word === label));
    if (linked.some((word) => !isStrictIdiom(word))) issues.push("idiom challenge links must use type idiom");
  }
  if (type === "phrasalTransform") {
    const linked = uniqueStrings(challenge.linkedWords).map((label) => wordSource.find((word) => word.word === label));
    if (!linked.length || linked.some((word) => !isPhrasal(word))) issues.push("phrasal transform must link loaded phrasal entries");
  }
  if (Array.isArray(challenge.steps)) {
    challenge.steps.forEach((step, index) => {
      const stepOptions = uniqueStrings(step.options);
      const stepAnswers = uniqueStrings([...(step.answer !== undefined ? [step.answer] : []), ...(Array.isArray(step.answers) ? step.answers : []), ...(Array.isArray(step.acceptedAnswers) ? step.acceptedAnswers : [])]);
      if (!stepAnswers.length) issues.push(`step ${index + 1} has no answer`);
      if (stepOptions.length && stepAnswers.some((answer) => !stepOptions.some((option) => normalizeAnswerText(option) === normalizeAnswerText(answer)))) issues.push(`step ${index + 1} answer is missing from options`);
    });
  }
  return issues;
}

export function getAllowedModes(word) {
  const base = ["meaning", "gap", "gapTyping", "situation", "typing"];
  if (isStrongStoryFallback(word)) base.push("story");
  if (word?.opposite || Math.random() < OPPOSITE_TRAP_RATE) base.push("opposite");
  if (canBuildWhoAmI(word)) base.push("whoami");
  if (canBuildTwoPerson(word)) base.push("twopeople", "selecttwo");
  if (isIdiom(word)) base.push("idiomDetective");
  if (["phrasal", "fyi"].includes(word?.type) && word?.transformExample) base.push("phrasalTransform");
  if (word?.skipTyping) return base.filter((m) => !["typing", "gapTyping", "phrasalTransform"].includes(m));
  return [...new Set(base)].filter((m) => !DISABLED_MODES.has(m) && !RUNTIME_DISABLED_MODES.has(m));
}

export function getAdaptiveDifficulty(word, stats, modeId) {
  const s = normalizeMasteryRecord(stats);
  const stage = getMasteryStage(s, { kind: "word", obj: word });
  const recent = s.recentResults.slice(-4);
  const recentCorrect = recent.filter((r) => r.correct).length;
  const acc = modeAccuracy(s, modeId);
  let difficulty = stage === MASTERY_STAGE.NEW ? 1 : stage === MASTERY_STAGE.FAMILIAR ? 2 : stage === MASTERY_STAGE.LEARNED ? 3 : 4;
  if (recent.length >= 2 && recentCorrect <= 1) difficulty -= 1;
  if (recent.length >= 3 && recentCorrect === recent.length) difficulty += 1;
  if (acc !== null && acc < 50) difficulty -= 1;
  if (acc !== null && acc >= 85 && s.modes[modeId]?.total >= 2) difficulty += 1;
  if ((modeId === "typing" || modeId === "gapTyping") && s.spellingMisses > 0) difficulty = Math.min(difficulty, 3);
  return Math.max(1, Math.min(modeId === "gap" || modeId === "gapTyping" ? 5 : 4, difficulty));
}

export function getStrongConfusion(word, confusions = {}) {
  const prefix = `${word.word}|`;
  return Object.entries(confusions)
    .filter(([key, value]) => key.startsWith(prefix) && confusionCount(value) >= 2)
    .map(([key, value]) => ({ partner: key.slice(prefix.length), count: confusionCount(value), lastAt: Number(value?.lastAt || 0) }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)[0] || null;
}

export function selectAdaptiveMode(word, masteryStats, context = {}) {
  const stats = normalizeMasteryRecord(masteryStats);
  const stage = getMasteryStage(stats, { kind: "word", obj: word });
  const allowed = new Set(getAllowedModes(word));
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
  if (context.sessionType === "weak") {
    base.typing = (base.typing || 0) + 1.5;
    base.situation = (base.situation || 0) + 1.5;
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

export function buildAdaptiveRound(level, mastery = {}, confusions = {}, sessionType = "level") {
  const allUnique = dedupeBy(level.items, levelItemKey);
  let unique = allUnique;
  if (sessionType === "level") {
    const filtered = allUnique.filter((item) => {
      if (item.kind === "challenge") return challengeProgressEligible(item.obj, mastery);
      if (item.kind !== "word") return true;
      const stats = mastery[item.obj.word];
      const mastered = getMasteryStage(stats, item) === MASTERY_STAGE.MASTERED;
      return !mastered || Math.random() < 0.18;
    });
    unique = filtered.length ? filtered : shuffle(allUnique).slice(0, Math.min(6, allUnique.length));
  }
  const result = [];
  let lastMode = null;
  const shuffledItems = shuffle(unique);
  if (LAST_CHALLENGE_ID && shuffledItems.length > 1 && shuffledItems[0]?.kind === "challenge" && shuffledItems[0].obj.id === LAST_CHALLENGE_ID) {
    const swapIndex = shuffledItems.findIndex((item, index) => index > 0 && !(item.kind === "challenge" && item.obj.id === LAST_CHALLENGE_ID));
    if (swapIndex > 0) [shuffledItems[0], shuffledItems[swapIndex]] = [shuffledItems[swapIndex], shuffledItems[0]];
  }
  for (const item of shuffledItems) {
    if (item.kind === "challenge") {
      result.push({ kind: "challenge", obj: item.obj });
      continue;
    }
    if (item.kind !== "word") {
      result.push(item.kind === "grammar" ? { kind: "grammar", obj: item.obj } : { kind: "pun", obj: item.obj });
      continue;
    }
    const stats = mastery[item.obj.word];
    const confusion = getStrongConfusion(item.obj, confusions);
    const mode = selectAdaptiveMode(item.obj, stats, { sessionType, confusion, lastMode });
    const difficulty = getAdaptiveDifficulty(item.obj, stats, mode);
    result.push({ kind: "word", wordObj: item.obj, mode, difficulty, confusionPartner: confusion?.partner || null });
    lastMode = mode;
  }
  return result;
}

export function buildRound(level, mastery = {}, confusions = {}, sessionType = "level") {
  return buildAdaptiveRound(level, mastery, confusions, sessionType);
}

/* --------------------------------- POOLS ----------------------------------- */
// Each word keeps independent, rotating content pools per question type
// (meaning / gap / situation / typing). Once a variant has been answered
// correctly twice, it locks for a week and a fresh one is generated so the
// same phrasing never gets memorized instead of the word itself.

export const POOL_TYPES = ["meaning", "gap", "situation", "typing"];
export const LOCK_DAYS = 7;

export function getWordPools(pools, word) {
  const existing = pools[word.word] || {};
  const current = { ...existing };
  for (const type of POOL_TYPES) current[type] = V2.poolItems(word, type, existing[type]);
  return current;
}

export function pickActiveItem(wordPools, poolType) {
  const arr = wordPools[poolType];
  const now = Date.now();
  const unlocked = arr.filter((it) => !it.lockedUntil || it.lockedUntil <= now);
  const candidates = unlocked.length ? unlocked : arr;
  return candidates.reduce((a, b) => (a.attempts <= b.attempts ? a : b));
}

export function poolHasFreshItem(wordPools, poolType) {
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
export function resolvePoolMode(modeId, wordObj, wordPools) {
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
export function areOpposites(a, b) {
  if (!a || !b) return false;
  const has = (x, y) => x.opposite === y.word || V2.antonymsOf(x).some((t) => V2.norm(V2.bareWord(t)) === V2.norm(V2.bareWord(y.word)));
  return has(a, b) || has(b, a);
}
// A wrong option for "opposite of X" must not be another opposite of X, or
// clash with the right answer (synonym / never-together).
export function safeOppositeDistractor(wordObj, answerObj, d) {
  return d.word !== wordObj.word && d.word !== answerObj?.word && !areOpposites(wordObj, d) && (!answerObj || V2.compatible(answerObj, d));
}
// Mode A — direct match: word shown, pick its opposite from 4 options.
export function buildOppositeDirect(wordObj) {
  const answerObj = findWordByLabel(wordObj.opposite);
  const distractors = sampleDistractors(wordObj, 5).filter((d) => safeOppositeDistractor(wordObj, answerObj, d)).slice(0, 3);
  while (distractors.length < 3) {
    const extra = shuffle(WORDS.filter((w) => safeOppositeDistractor(wordObj, answerObj, w) && !distractors.includes(w)))[0];
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
export function buildOppositeSentence(wordObj) {
  const context = contextSentence(wordObj);
  if (!context) return buildOppositeDirect(wordObj);
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: `${wordObj.word} ↔ ${wordObj.opposite}` };
  const options = shuffle([wordObj.word, wordObj.opposite]);
  return { target, prompt: context, options, answer: wordObj.word, type: "mcq" };
}

// Mode C — "Opposite or not?": two words, judge whether they're a real pair.
// True half the time (the real opposite); false half the time (a plausible
// but wrong same-category word), so "No" isn't just the safe guess.
export function buildOppositePairJudgment(wordObj) {
  const isTruePair = Math.random() < 0.5;
  let partner;
  if (isTruePair) {
    partner = wordObj.opposite;
  } else {
    const sameGroup = WORDS.filter(
      (w) => w.word !== wordObj.word && !areOpposites(wordObj, w) && w.category === wordObj.category && w.type === wordObj.type
    );
    const pool = sameGroup.length ? sameGroup : WORDS.filter((w) => w.word !== wordObj.word && !areOpposites(wordObj, w));
    partner = shuffle(pool)[0]?.word;
  }
  if (!partner) return buildOppositeDirect(wordObj);
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
export function buildOppositeTrap(wordObj) {
  const distractors = sampleDistractors(wordObj, 3);
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: "No clear opposite",
    explanation: `${wordObj.word} doesn't have one clear, well-known opposite in this set.`,
  };
  const options = shuffle(["No clear opposite", ...distractors.map((d) => d.word)]);
  return { target, prompt: wordObj.word, options, answer: "No clear opposite", type: "mcq" };
}

export function buildOppositeQuestion(wordObj) {
  if (!wordObj.opposite) return buildOppositeTrap(wordObj);
  const r = Math.random();
  if (r < 0.34) return buildOppositeDirect(wordObj);
  if (r < 0.67) return buildOppositeSentence(wordObj);
  return buildOppositePairJudgment(wordObj);
}

// --- Who Am I? — the word narrates its own meaning in first person. ---
// Only meanings phrased as a description ("Unable to make decisions...")
// convert cleanly; verb-style ones ("To deliberately say or do...") read
// oddly in first person, so those words simply don't get this mode.
export function firstPersonify(meaning) {
  if (!meaning) return null;
  let m = meaning.trim();
  if (/^(to\s|an?\s|the\s|someone\b|something\b|used to say\b)/i.test(m)) return null;
  m = m.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!m) return null;
  return `I'm ${m.charAt(0).toLowerCase()}${m.slice(1)}.`;
}

export function canBuildWhoAmI(w) {
  return w?.type === "vocab" && firstPersonify(w.meaning) !== null;
}

export function buildWhoAmIQuestion(wordObj) {
  const riddle = firstPersonify(wordObj.meaning);
  const distractors = sampleDistractors(wordObj, 3);
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  const options = shuffle([wordObj.word, ...distractors.map((d) => d.word)]);
  return { target, prompt: `${riddle} Who am I?`, options, answer: wordObj.word, type: "mcq" };
}

// --- Two People / Select Two — combine two context sentences (usually the
// gap sentences) into one harder question, without needing new authored
// content. A "companion" word from the same category supplies the second.
// `ctx` picks the sentence for a word (default: its first gap sentence);
// practice passes one that returns only sentences the learner hasn't seen.
export function pickCompanion(wordObj, ctx = contextSentence) {
  const source = normalizeAnswerText(ctx(wordObj));
  const pool = WORDS.filter((w) =>
    w.word !== wordObj.word &&
    w.category === wordObj.category &&
    ctx(w) &&
    normalizeAnswerText(ctx(w)) !== source &&
    !situationLeaks(wordObj, ctx(w)) &&
    meaningSimilarity(w.meaning, wordObj.meaning) < 0.55
  );
  return pool.length ? shuffle(pool)[0] : null;
}

export function canBuildTwoPerson(wordObj) {
  return !!contextSentence(wordObj) && pickCompanion(wordObj) !== null;
}

export function fillToFour(base, exclude) {
  const options = [...base];
  if (options.length >= 4) return options.slice(0, 4);
  const more = shuffle(WORDS.filter((w) => !exclude.has(w.word) && !options.includes(w.word)));
  for (const w of more) {
    if (options.length >= 4) break;
    options.push(w.word);
  }
  return options;
}

export function buildTwoPeopleQuestion(wordObj, ctx = contextSentence) {
  const mine = ctx(wordObj);
  const companion = mine ? pickCompanion(wordObj, ctx) : null;
  if (!companion) return null;
  const theirs = ctx(companion);
  const askFirst = Math.random() < 0.5;
  const distractors = sampleDistractors(wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour([wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
  const prompt = askFirst
    ? `Person A: "${mine}"\n\nPerson B: "${theirs}"\n\nWhich word belongs to Person A?`
    : `Person A: "${theirs}"\n\nPerson B: "${mine}"\n\nWhich word belongs to Person B?`;
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  return { target, prompt, options, answer: wordObj.word, type: "mcq", sentences: [mine, theirs] };
}

export function buildSelectTwoQuestion(wordObj, ctx = contextSentence) {
  const mine = ctx(wordObj);
  const companion = mine ? pickCompanion(wordObj, ctx) : null;
  if (!companion) return null;
  const distractors = sampleDistractors(wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour([wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
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

// --- Speed Round: a standalone timed mode for reviewing words already
// mastered — not for first learning. Picks a random mastered word and a
// fast MCQ style (never typing/multi, which take too long under a clock),
// reusing whatever content is currently active in that word's pools
// read-only, so nothing here touches pool locks, mastery, or triggers
// regeneration the way a normal round answer would.
export const SPEED_MODES = ["meaning", "gap", "situation"];

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
export function buildSpeedQuestion(pool) {
  for(const w of shuffle(pool)) {
    const choices=V2.optionWords([w],WORDS,4).map(x=>x.word);
    const prompts=[w.meaning,...(/_{2,}/.test(w.gap)?[w.gap]:[])].filter(text=>text&&text.length<=180&&!V2.norm(text).includes(V2.norm(w.word)));
    if(choices.length>=2&&prompts.length)return {target:{...w,key:w.word,label:w.word},prompt:shuffle(prompts)[0],options:choices,answer:w.word,type:"mcq"};
  }
  return null;
}


export function findWordByLabel(label) {
  const key = String(label || "").trim().toLowerCase();
  return WORDS.find((w) => String(w.word || "").trim().toLowerCase() === key) || null;
}

export function semanticRelation(a, b) {
  if (!a || !b || a.word === b.word) return null;
  if (a.opposite && String(a.opposite).toLowerCase() === String(b.word).toLowerCase()) return "antonym";
  if (b.opposite && String(b.opposite).toLowerCase() === String(a.word).toLowerCase()) return "antonym";
  const sim = meaningSimilarity(a.meaning, b.meaning);
  if (sim >= 0.45) return "related concept";
  if (a.semanticGroup && b.semanticGroup && a.semanticGroup === b.semanticGroup) return `semantic group: ${a.semanticGroup}`;
  if (a.wordFamily && b.wordFamily && a.wordFamily === b.wordFamily) return `word family: ${a.wordFamily}`;
  return null;
}

export function hardDistractors(target, count = 3) { return sampleDistractors(target, count); }

export function buildImpostorQuestion(wordObj, difficulty = 2) {
  const authored = authoredChallengesForWord(wordObj, "impostor");
  if (!authored.length) return null;
  return buildChallengeQuestion(shuffle(authored)[0]);
}

export function safeLegacyQuestion(q) {
  if (!q) return q;
  const lists = [q.options, ...(q.steps || []).map(step => step.options)].filter(Array.isArray);
  let invalid = false;
  for (const list of lists) {
    if (list.length < 2 || new Set(list.map(V2.norm)).size !== list.length) invalid = true;
    const refs = list.map(label => WORDS.find(w => V2.norm(w.word) === V2.norm(label) || V2.norm(w.meaning) === V2.norm(label))).filter(Boolean);
    if (refs.some((w, i) => refs.slice(i + 1).some(other => !V2.compatible(w, other)))) invalid = true;
  }
  return invalid ? { ...q, type: "unavailable", prompt: "This authored question conflicts with option exclusions or has too few unique options. Report it or continue; no mastery credit is awarded." } : q;
}
export function buildQuestion(...args) { return safeLegacyQuestion(buildQuestionUnsafe(...args)); }
export function buildChallengeQuestion(...args) { return safeLegacyQuestion(buildChallengeQuestionUnsafe(...args)); }

export function buildQuestionUnsafe(modeId, wordObj, pools, options = {}) {
  const difficulty = Math.max(1, Number(options.difficulty || 1));
  const confusionPartner = options.confusionPartner || null;
  if (modeId === "opposite") return { ...buildOppositeQuestion(wordObj), modeId, difficulty };
  if (modeId === "whoami") return { ...buildWhoAmIQuestion(wordObj), modeId, difficulty };
  if (modeId === "twopeople") return { ...(buildTwoPeopleQuestion(wordObj) || buildQuestion("situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "selecttwo") return { ...(buildSelectTwoQuestion(wordObj) || buildQuestion("situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "impostor") return buildImpostorQuestion(wordObj, difficulty) || buildQuestion("situation", wordObj, pools, { ...options, difficulty: Math.min(2, difficulty) });

  if (modeId === "story") {
    const authored = authoredChallengesForWord(wordObj, "story");
    if (authored.length) return buildChallengeQuestion(shuffle(authored)[0]);
    if (isStrongStoryFallback(wordObj)) {
      const distractors = hardDistractors(wordObj, 3, confusionPartner);
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
    return buildQuestion("situation", wordObj, pools, options);
  }

  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  if (modeId === "phrasalTransform" && ["phrasal", "fyi"].includes(wordObj.type) && wordObj.transformExample) {
    return { target, modeId, difficulty, type: "typing", prompt: `Use “${wordObj.word}”: ${wordObj.transformExample.before}`, answer: wordObj.transformExample.after, acceptedAnswers: [wordObj.transformExample.after], modelOnly: true, freeformKind: "phrasalTransform" };
  }
  if (modeId === "phrasalTransform") {
    if (!isPhrasal(wordObj)) return buildQuestion("gapTyping", wordObj, pools, options);
    const authored = authoredChallengesForWord(wordObj, "phrasalTransform");
    return authored.length ? buildChallengeQuestion(shuffle(authored)[0]) : buildQuestion("gapTyping", wordObj, pools, options);
  }
  if (modeId === "idiomDetective") {
    if (!isIdiom(wordObj)) return buildQuestion("situation", wordObj, pools, options);
    if (difficulty <= 2) {
      const context = contextSentence(wordObj);
      if (!context) return buildQuestion("gap", wordObj, pools, options);
      const distractors = hardDistractors(wordObj, 3, confusionPartner);
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
  const distractors = difficulty >= 3 ? hardDistractors(wordObj, 3, confusionPartner) : sampleDistractors(wordObj, 3);

  if (modeId === "meaning" && difficulty >= 2) {
    const hard = difficulty >= 3 ? hardDistractors(wordObj, 3, confusionPartner) : distractors;
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
export function buildGrammarQuestion(g) {
  const target = { ...g, key: `grammar:${g.id}`, label: g.rule, explanation: g.explanation };
  const q = V2.grammarQuestions(g).find((x) => x.type === "choose") || { prompt: g.prompt, options: g.options || [], answer: g.answer };
  return { target, modeId: "grammarCourt", prompt: q.prompt, options: shuffle(q.options), answer: q.answer, type: "mcq", court: true };
}

export function buildEntryQuestion(entry, pools) {
  if (entry.kind === "word") return buildQuestion(entry.mode, entry.wordObj, pools, { difficulty: entry.difficulty, confusionPartner: entry.confusionPartner });
  if (entry.kind === "grammar") return buildGrammarQuestion(entry.obj);
  if (entry.kind === "challenge") return buildChallengeQuestion(entry.obj);
  return null;
}

// Adaptive builders remain question factories, but all questions are
// normalized into one V2 session/answer contract. There is no second runner.
export function legacyQuestionToV2(question, entry, idSuffix = "0") {
  if (!question) return [];
  const mode = question.modeId || (entry.kind === "challenge" ? challengeType(entry.obj) : entry.kind);
  const linkedWords = entry.kind === "word" ? [entry.wordObj.word] : entry.kind === "challenge" ? challengeLinkedWords(entry.obj) : [];
  const progressKeys = entry.kind === "word" ? linkedWords : entry.kind === "grammar" ? [`grammar:${entry.obj.id}`] : entry.kind === "pun" ? [`pun:${entry.obj.id}`] : [`challenge:${entry.obj.id}`, ...linkedWords];
  const base = { id:`v2:${entry.kind}:${entry.obj?.id||entry.wordObj?.word||idSuffix}:${idSuffix}`, mode, targets:linkedWords, progressKeys, prompt:question.prompt, explanation:question.explanation||question.target?.explanation||"", difficulty:question.difficulty||entry.difficulty||1, poolType:question.poolType, poolItemId:question.poolItemId, challengeId:question.challengeId };
  if (question.type === "multiStage") return question.steps.flatMap((step,index)=>legacyQuestionToV2({...question,type:step.type,prompt:step.prompt,options:step.options,answer:step.acceptedAnswers?.[0],acceptedAnswers:step.acceptedAnswers,explanation:step.explanation||question.explanation,steps:undefined},entry,`${idSuffix}-step-${index+1}`));
  if (question.type === "unavailable") return [{...base,type:"mcq",options:["Skip this invalid question"],answers:["Skip this invalid question"],noMastery:true,noTelemetry:true}];
  if (question.type === "selfCheck") return [{...base,type:"typing",answers:[question.exampleAnswer||question.answer||""],objectiveTerms:question.requiredWords||linkedWords,noMastery:true}];
  if (question.type === "multi") return [{...base,type:"multi",options:question.options||[],answers:question.correctAnswers||question.acceptedAnswers||[]}];
  if (question.type === "freeform" || question.type === "typing") return [{...base,type:"typing",answers:question.acceptedAnswers?.length?question.acceptedAnswers:[question.answer],modelOnly:!!question.modelOnly||question.type==="freeform",freeformKind:question.freeformKind}];
  return [{...base,type:"mcq",options:question.options||[],answers:[question.answer]}];
}

export let poolsSnapshotForSession = {};
export function setPoolsSnapshotForSession(pools) { poolsSnapshotForSession = pools; }
export function v2SessionFromEntries(entries, {kind,title,idPrefix=kind}) {
  const queue=entries.flatMap((entry,index)=>legacyQuestionToV2(buildEntryQuestion(entry,poolsSnapshotForSession),entry,String(index)));
  return {id:`${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,kind,title,queue,introductions:[],index:0,answers:[],initialLength:queue.length};
}

export function entryFileMeta(entry) {
  if (entry.kind === "word") return MODE_META[entry.mode];
  if (entry.kind === "grammar") return { label: "Grammar Court", icon: Scale };
  if (entry.kind === "challenge") return CHALLENGE_MODE_META[challengeType(entry.obj)] || { label: "Challenge", icon: BookOpen };
  return { label: "Puns", icon: Sparkles };
}
