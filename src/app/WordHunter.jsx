import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Award, BarChart3, BookOpen, CheckCircle2, ClipboardCheck, Copy, Download, Flag, Flame, HelpCircle, ListChecks, Lock, Play, Search, Sparkles, Target, Trash2, Trophy, Upload, Users, Volume2, X, Zap } from "lucide-react";
import { V2 } from "../engine/v2";
import { PronunciationModal, imageLinkOk } from "../features/media/media";
import { SessionView } from "../features/session/SessionView";
import { Splash } from "../features/auth/LoginPage";
import { BADGES, BUILTIN_CHALLENGES, BUILTIN_GRAMMAR, BUILTIN_WORDS, CHALLENGES, GRAMMAR, LEVELS, LEVEL_ORDER, MASTERY_STAGE, MASTERY_STAGE_RANK, PRODUCTION_MODES, RECENT_RESULT_LIMIT, TOPIC_ICONS, WORDS, confusionCount, formatAccuracy, formatStars, getMasteryStage, getStarsForAccuracy, isWordKey, levelGroups, levelItemKey, levelStageBreakdown, mergeCustomData, nextStudyStreakState, normalizeMasteryRecord, normalizeModeStats, setLastChallengeId, setRuntimeDisabledModes, todayProgress, updateLevelStat, updateReviewStreak } from "../engine/data";
import { LOCK_DAYS, SPEED_QUEUE_SIZE, SPEED_SECONDS, buildEntryQuestion, buildQuestion, buildSelectTwoQuestion, buildSpeedQuestion, buildTwoPeopleQuestion, entryFileMeta, findWordByLabel, getAdaptiveDifficulty, getAllowedModes, getStrongConfusion, getWordPools, legacyQuestionToV2, poolNeedsGeneration, selectAdaptiveMode, setPoolsSnapshotForSession, shuffle, situationLeaks, speedQuestionV2, speedStats, uniqueStrings, v2SessionFromEntries } from "../engine/questions";
import { aiFixImportJson, askAiForWord, buildContrastiveFeedback, containsRequiredTerm, evaluateAlternativeGap, evaluateFinalReport, evaluateFreeForm, evaluateGrammarCorrection, explainWrongLead, generateComboVariant, generateContent, generateGrammarVariant, generateStory, locateReportSource, normalizeAnswerText, reviewReportedQuestion, spellingDistanceInfo } from "../engine/ai";
import { DEFAULT_SETTINGS, SCHEMA_VERSION, deriveLearningInsights, emptyProgressData, getBadgeProgress, getWeakWordCandidates, insertLevelTitles, migrateProgressData, normalizeSettings, pickWeakMode, pruneConfusions } from "../engine/progress";
import { BottomNav, ScreenSkeleton, SyncStatus } from "../features/shell/Shell";
import { navigate, parseRoute, pathFor, useLocation } from "../lib/router";
// Screens most players open rarely load on demand, keeping the first
// download small: Admin (and all its tools), Live, Leaderboard, Profile.
// The Admin tab reopens the admin page (and filters) used last.
const lastAdminPath = () => { try { const p = localStorage.getItem("wh-admin-path"); return p && p.startsWith("/admin") ? p : "/admin"; } catch { return "/admin"; } };
const PLAY_SCREENS = new Set(["session", "playing", "results", "reviewResults", "finalReport", "finalResults", "speed", "speedResults"]);
const AdminPanel = lazy(() => import("../features/admin/AdminPanel").then((m) => ({ default: m.AdminPanel })));
const LiveChallenge = lazy(() => import("../features/live/LiveChallenge").then((m) => ({ default: m.LiveChallenge })));
const Leaderboard = lazy(() => import("../features/social/Leaderboard"));
const ProfilePage = lazy(() => import("../features/social/ProfilePage"));

export default function WordHunter({ repo, profile = null, isAdmin = true }) {
  const [loaded, setLoaded] = useState(false);
  const [storageWarning, setStorageWarning] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const livePlayer = useMemo(() => (profile && profile.id !== "local"
    ? { id: profile.id, name: profile.username }
    : { id: `tab-${Math.random().toString(36).slice(2, 8)}`, name: `Player ${Math.floor(Math.random() * 90 + 10)}` }), [profile?.id, profile?.username]);
  const [customCombos, setCustomCombos] = useState([]);
  const [customStories, setCustomStories] = useState([]);
  const [askAiOpen,setAskAiOpen]=useState(false);
  const [askAiTerm,setAskAiTerm]=useState("");
  const [listenTerm,setListenTerm]=useState(null);
  const [askAiResult,setAskAiResult]=useState(null);
  const [askAiBusy,setAskAiBusy]=useState(false);
  const [askAiError,setAskAiError]=useState(null);
  const [selectedStoryCategories,setSelectedStoryCategories]=useState([]);
  const [storyGenError,setStoryGenError]=useState("");
  const [storyGenState, setStoryGenState] = useState(null); // null | 'loading' | 'error' | {title,text,targetWords,questions}
  async function handleGenerateStory() {
    if(!selectedStoryCategories.length){setStoryGenError("Choose at least one category first.");return;}
    setStoryGenState("loading");
    setStoryGenError("");
    try {
      const usedElsewhere=new Set(customStories.flatMap(story=>(story.targetWords||[]).map(w=>V2.norm(w))));
      const weakOrder=new Map(getWeakWordCandidates(WORDS,mastery,confusions).map((item,index)=>[item.word.word,index]));
      // Words already used as a target in an earlier generated story are
      // pushed to the back of each category's pool (not hard-excluded) —
      // so a new story reaches for fresh vocabulary first, and only falls
      // back to a repeat if a category genuinely has nothing left unused.
      const byCategory=selectedStoryCategories.map(category=>{
        const all=V2.shuffleCopy(WORDS.filter(word=>word.category===category),Math.random).sort((a,b)=>(weakOrder.get(a.word)??9999)-(weakOrder.get(b.word)??9999));
        const fresh=all.filter(w=>!usedElsewhere.has(V2.norm(w.word)));
        const reused=all.filter(w=>usedElsewhere.has(V2.norm(w.word)));
        return {category,words:[...fresh,...reused]};
      }).filter(group=>group.words.length);
      const vocabAvailable=byCategory.reduce((sum,group)=>sum+group.words.filter(w=>(w.type||"vocab")==="vocab").length,0);
      if(vocabAvailable<5)throw new Error("The selected categories need at least five vocab words in total.");
      const targets=[];
      // "idiom / binomial / fyi / phrasal" targets are ADDITIONAL to the 5-7
      // vocab targets below, not counted against that budget — pick one of
      // each (when the selected categories actually contain one), randomly
      // among the weakest few so a manual "Regenerate" isn't stuck retrying
      // the same troublesome word forever.
      const REQUIRED_TYPES=["idiom","binomial","fyi","phrasal"];
      const allWords=byCategory.flatMap(group=>group.words);
      for(const type of REQUIRED_TYPES){
        const candidates=allWords.filter(w=>w.type===type&&!targets.some(t=>t.word===w.word)).sort((a,b)=>(usedElsewhere.has(V2.norm(a.word))?1:0)-(usedElsewhere.has(V2.norm(b.word))?1:0)||(weakOrder.get(a.word)??9999)-(weakOrder.get(b.word)??9999)).slice(0,3);
        const pick=candidates.length?candidates[Math.floor(Math.random()*candidates.length)]:null;
        if(pick)targets.push(pick);
      }
      // Now fill the separate 5-7 vocab-only budget via the same
      // weak-word-first, round-robin-across-categories approach.
      const vocabByCategory=byCategory.map(group=>({category:group.category,words:group.words.filter(w=>(w.type||"vocab")==="vocab")}));
      const vocabTargetCount=Math.min(7,Math.max(5,selectedStoryCategories.length+3),vocabAvailable);
      const vocabTargets=[];
      while(vocabTargets.length<vocabTargetCount&&vocabByCategory.some(group=>group.words.length))for(const group of vocabByCategory){if(vocabTargets.length>=vocabTargetCount)break;const word=group.words.shift();if(word&&!vocabTargets.some(item=>item.word===word.word))vocabTargets.push(word);}
      targets.push(...vocabTargets);
      // Pick which grammar RULES to weave in (up to 2, deduped by rule text)
      // from the selected categories — the AI writes the actual example
      // sentence and question, then generateStory verifies it's really in
      // the story before trusting it.
      const grammarRulePool=V2.shuffleCopy((GRAMMAR||[]).filter(g=>selectedStoryCategories.some(cat=>V2.topic(cat)===V2.topic(g.category))),Math.random);
      const seenRules=new Set(),grammarRules=[];
      for(const g of grammarRulePool){const key=V2.norm(g.rule);if(seenRules.has(key))continue;seenRules.add(key);grammarRules.push({rule:g.rule,category:g.category});if(grammarRules.length>=2)break;}
      const story = await generateStory(V2.shuffleCopy(targets,Math.random),selectedStoryCategories,grammarRules);
      setStoryGenState(story);
    } catch (e) {
      console.error("Word Hunter: story generation failed", e);
      setStoryGenError(e.message||"Story generation failed.");
      setStoryGenState("error");
    }
  }
  function toggleStoryCategory(category){setStoryGenState(null);setStoryGenError("");setSelectedStoryCategories(current=>current.includes(category)?current.filter(item=>item!==category):[...current,category]);}

  const [activeSession, setActiveSession] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => { setRuntimeDisabledModes(new Set(settings.enablePairModes ? [] : ["twopeople", "selecttwo"])); }, [settings.enablePairModes]);
  const [questionReports,setQuestionReports]=useState([]);
  // Reported (word, mode) pairs are quarantined — excluded from being
  // picked again by the adaptive question generators — until an admin
  // resolves or retires the report. Keyed as `word|mode` (lowercased).
  const reportQuarantine = useMemo(() => {
    const set = new Set();
    for (const r of questionReports) {
      if (r.resolvedAt) continue;
      const words = r.targetWords?.length ? r.targetWords : [null];
      for (const w of words) if (w) set.add(`${String(w).trim().toLowerCase()}|${r.mode}`);
    }
    return set;
  }, [questionReports]);
  const [solvedStories,setSolvedStories]=useState([]);
  const [sessionLogs,setSessionLogs]=useState([]);
  const [dailyProgress,setDailyProgress]=useState(null);
  const recordedSessionAnswersRef = useRef(new Set());
  // Where we are comes from the address bar (see lib/router.js). The play
  // screens (a session and its result cards) all live under /play.
  const location = useLocation();
  const route = useMemo(() => parseRoute(location.path), [location.path]);
  const [playScreen, setPlayScreen] = useState("session");
  const lastSectionRef = useRef("practice");
  const screen = route.screen === "play" ? playScreen : route.screen === "notFound" ? "levels" : route.screen;
  const section = route.screen === "levels" ? route.section : lastSectionRef.current;
  if (route.screen === "levels") lastSectionRef.current = route.section;
  function setScreen(next) {
    if (PLAY_SCREENS.has(next)) { setPlayScreen(next); navigate("/play"); }
    else if (next === "admin") navigate(lastAdminPath());
    else navigate(pathFor(next, next === "levels" ? { section: lastSectionRef.current } : {}));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }
  function setSection(id) { navigate(pathFor("levels", { section: id })); }
  // Leaving /play forgets which result card was showing: coming Back to
  // /play resumes the open session or goes home.
  useEffect(() => { if (route.screen !== "play" && playScreen !== "session") setPlayScreen("session"); }, [route.screen]);
  const progressExtrasRef = useRef({});
  const contentNoteRef = useRef("");
  function liveContent() { return { words: WORDS, grammar: GRAMMAR, challenges: CHALLENGES, combos: customCombos, stories: customStories, note: contentNoteRef.current }; }
  function launchSession(session) { setActiveSession(session); setScreen("session"); }
  // One extra question style per word for Level Practice, built with the
  // adaptive-engine builders and converted to the V2 question shape.
  function buildPracticeExtra(wordObj, stage, rng = Math.random) {
    const allowed = new Set(getAllowedModes(wordObj));
    const byStage = stage === "Familiar" ? ["whoami", "idiomDetective", "story", "opposite"] : ["whoami", "idiomDetective", "story", "opposite", "twopeople", "selecttwo"];
    const clues = V2.outsideAntonyms(wordObj, WORDS);
    // Word Partners / Word Family come from collocations and wordFamily;
    // typed once the word is Learned.
    const typed = stage === "Learned" || stage === "Mastered";
    const partners = V2.collocationQuestion(wordObj, WORDS, rng, typed) || (typed ? V2.collocationQuestion(wordObj, WORDS, rng, false) : null);
    const family = V2.familyQuestion(wordObj, rng, typed) || (typed ? V2.familyQuestion(wordObj, rng, false) : null);
    const picture = V2.pictureQuestion(wordObj, WORDS, rng, typed, imageLinkOk);
    const modes = [...byStage.filter((m) => allowed.has(m) && (m !== "opposite" || wordObj.opposite)), ...(clues.length ? ["antonym"] : []), ...(partners ? ["collocation"] : []), ...(family ? ["family"] : []), ...(picture ? ["picture"] : [])];
    if (!modes.length) return null;
    const mode = modes[Math.floor(rng() * modes.length)];
    if (mode === "collocation") return partners;
    if (mode === "family") return family;
    if (mode === "picture") return picture;
    // Opposite Clue: an antonym from outside the game points at this word
    // ("The opposite of “shrink” is…" → Swell). Typed once the word is Learned.
    if (mode === "antonym") {
      const clue = clues[Math.floor(rng() * clues.length)];
      const base = { id: `${wordObj.word}:antonym`, mode: "antonym", targets: [wordObj.word], answers: [wordObj.word], prompt: `The opposite of “${clue}” is…`, explanation: `${wordObj.word} ↔ ${clue}. ${wordObj.meaning || ""}`.trim(), hints: wordObj.hints || [], difficulty: 2 };
      if (stage === "Learned" || stage === "Mastered") return { ...base, type: "typing" };
      // No other word the clue is also the opposite of.
      const options = V2.optionWords([wordObj], WORDS, 6, rng).filter((x) => x.word === wordObj.word || !V2.antonymsOf(x).some((a) => V2.norm(a) === V2.norm(clue))).slice(0, 4).map((x) => x.word);
      if (!options.includes(wordObj.word)) return null;
      return options.length >= 2 ? { ...base, type: "mcq", options } : null;
    }
    try {
      // Two People / Select Two only use sentences never shown before: any
      // gap sentence of the word (authored or AI-written) not yet seen.
      let raw;
      if (mode === "twopeople" || mode === "selecttwo") {
        const seen = progressExtrasRef.current.seenSentences || {};
        const fresh = (w) => V2.poolItems(w, "gap", poolsRef.current?.[w.word]?.gap).map((it) => it.text).find((t) => t && /_{2,}/.test(t) && !situationLeaks(w, t) && !V2.seenRecently(seen, t, Infinity)) || null;
        const pair = mode === "twopeople" ? buildTwoPeopleQuestion(wordObj, fresh) : buildSelectTwoQuestion(wordObj, fresh);
        if (!pair) return null;
        raw = { ...pair, modeId: mode, difficulty: 2 };
      } else raw = buildQuestion(mode, wordObj, poolsRef.current, { difficulty: 2 });
      // Multi-step authored challenges don't fit a single practice slot.
      const built = legacyQuestionToV2(raw, { kind: "word", wordObj }, mode);
      const q = built.length === 1 ? { ...built[0], ...(raw.sentences ? { sentences: raw.sentences } : {}) } : null;
      if (!q || q.noMastery || !q.targets?.length) return null;
      // Last line of defence: never show a prompt that spells out an answer.
      if ((q.answers || []).some((a) => String(a).length > 2 && normalizeAnswerText(q.prompt).includes(normalizeAnswerText(a)))) return null;
      return { ...q, id: `${wordObj.word}:${q.mode}` };
    } catch {
      return null;
    }
  }
  function launchStory(story) { try { launchSession(V2.storySession(story, WORDS, masteryRef.current)); } catch(e) { setToast({text:e.message}); } }
  function launchChain(group) { try { const session = V2.chainSession(group, WORDS, masteryRef.current); if(!session.queue.length) {setToast({text:"No eligible opposite questions yet."});return;} launchSession(session); } catch(e) { setToast({text:e.message}); } }
  function introduceWords(words) { const next={...masteryRef.current}; words.forEach(w=>{next[w.word]={...next[w.word], introducedAt:next[w.word]?.introducedAt||Date.now()};}); masteryRef.current=next;setMastery(next);recordStudyDay(); }
  // V2 keeps mastery evidence session-based so repeated questions cannot inflate
  // a word's stage. Global telemetry is still recorded once, at answer time,
  // just like the legacy engine. This also makes partially completed/resumed
  // sessions contribute to score, streaks, attempts and confusion learning.
  // Remember every sentence the learner has read (answered or reported) so
  // practice keeps it away for a while. The newest 4000 are kept.
  // Live Challenge: words in the chosen lesson whose gap sentences have all
  // been read get new ones written in the background, for the next matches.
  const [liveSeenTick, setLiveSeenTick] = useState(0);
  function refreshLiveSentences(words) {
    const seenNow = progressExtrasRef.current.seenSentences || {};
    const exhausted = words.filter((w) => /_{2,}/.test(w.gap || "") && V2.poolItems(w, "gap", poolsRef.current?.[w.word]?.gap).every((it) => V2.seenRecently(seenNow, it.text))).slice(0, 8);
    if (exhausted.length) triggerGeneration(exhausted.map((w) => ({ word: w.word, poolType: "gap" })), poolsRef.current);
  }
  function markSentencesSeen(q) {
    const read = V2.questionSentences(q);
    if (!read.length) return;
    const now = Date.now(), seen = { ...(progressExtrasRef.current.seenSentences || {}) };
    read.forEach((key) => { seen[key] = now; });
    const entries = Object.entries(seen);
    progressExtrasRef.current = { ...progressExtrasRef.current, seenSentences: entries.length > 4000 ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 4000)) : seen };
  }
  function recordSessionResult(q, result, session) {
    if (q && result && session?.kind !== 'speed') markSentencesSeen(q);
    if (!q || !result || result.reported || result.unverified || result.aiFailed || q.noTelemetry) return;
    const answerKey = `${session?.id || 'session'}:${session?.index ?? -1}`;
    if (recordedSessionAnswersRef.current.has(answerKey)) return;
    recordedSessionAnswersRef.current.add(answerKey);
    const independentCorrect = !!result.correct && !result.assisted;
    const prevDay = todayProgress(progressExtrasRef.current.dailyProgress);
    const nextDay = { ...prevDay, answered: prevDay.answered + 1, correct: prevDay.correct + (result.correct ? 1 : 0) };
    progressExtrasRef.current = { ...progressExtrasRef.current, dailyProgress: nextDay };
    setDailyProgress(nextDay);
    if (prevDay.answered < settings.dailyGoal && nextDay.answered >= settings.dailyGoal) setToast({ text: `Daily goal reached: ${settings.dailyGoal} questions today. Anything more is a bonus!` });
    setAttempted((n) => n + 1);
    setStreak((current) => {
      const next = independentCorrect ? current + 1 : 0;
      setBestStreak((best) => Math.max(best, next));
      return next;
    });
    if (independentCorrect) setScore((value) => value + 10);

    if (q.poolType === 'combo' || q.poolType === 'grammar') {
      const key = q.progressKey;
      if (key) {
        const now = Date.now(), snapshot = poolsRef.current;
        const existing = snapshot[key]?.variant?.length ? snapshot[key].variant : [{ id: 'seed', attempts: 0, correctCount: 0, lockedUntil: null }];
        let found = false;
        const items = existing.map((item) => {
          if (item.id !== q.poolItemId) return item;
          found = true;
          const attempts = Number(item.attempts || 0) + 1;
          const correctCount = Number(item.correctCount || 0) + (independentCorrect ? 1 : 0);
          return { ...item, attempts, correctCount, lockedUntil: correctCount >= 2 ? now + LOCK_DAYS * 86400000 : item.lockedUntil };
        });
        if (!found) items.push({ id: q.poolItemId, attempts: 1, correctCount: independentCorrect ? 1 : 0, lockedUntil: null });
        const nextPools = { ...snapshot, [key]: { ...snapshot[key], variant: items } };
        poolsRef.current = nextPools; setPools(nextPools);
        const stillFresh = items.some((it) => !it.lockedUntil || it.lockedUntil <= now);
        if (!stillFresh) triggerVariantGeneration(q.poolType, key);
      }
    } else if (q.poolType && q.poolItemId && q.targets?.length) {
      const wordObj=V2.findWord(WORDS,q.targets[0]);
      if (wordObj) {
        const now=Date.now(), snapshot=poolsRef.current, wordPools=getWordPools(snapshot,wordObj);
        const items=wordPools[q.poolType].map(item=>{
          if(item.id!==q.poolItemId)return item;
          const attempts=Number(item.attempts||0)+1;
          const correctCount=Number(item.correctCount||0)+(independentCorrect?1:0);
          return {...item,attempts,correctCount,lockedUntil:correctCount>=2?now+LOCK_DAYS*86400000:item.lockedUntil};
        });
        const nextWordPools={...wordPools,[q.poolType]:items}, nextPools={...snapshot,[wordObj.word]:nextWordPools};
        poolsRef.current=nextPools;setPools(nextPools);
        // Keep one unseen variant ready: after a correct answer, if nothing
        // besides the text just shown is still fresh, write a new one now so
        // the next time this word comes up it has a different sentence.
        const freshOthers=items.some(it=>it.id!==q.poolItemId&&(!it.lockedUntil||it.lockedUntil<=now));
        if(poolNeedsGeneration(nextWordPools,q.poolType)||(independentCorrect&&!freshOthers))triggerGeneration([{word:wordObj.word,poolType:q.poolType}],nextPools);
      }
    }

    if (result.correct || !['mcq', 'multi'].includes(q.type)) return;
    const selected = Array.isArray(result.value) ? result.value : [result.value];
    const answerSet = new Set((q.answers || []).map(V2.norm));
    const missingTargets = (q.targets || []).map((label) => V2.findWord(WORDS, label)).filter(Boolean);
    const wrongChoices = selected.map((value) => {
      if (q.mode === 'meaning') return WORDS.find((word) => V2.norm(word.meaning) === V2.norm(value));
      return V2.findWord(WORDS, value);
    }).filter((word) => word && !answerSet.has(V2.norm(q.mode === 'meaning' ? word.meaning : word.word)));
    wrongChoices.forEach((choice, index) => {
      const target = missingTargets[Math.min(index, missingTargets.length - 1)];
      if (target) trackConfusion(target, choice.word);
    });
  }
  function completeSession(session) {
    if(session.kind==="speed"){
      if((progressExtrasRef.current.completedSessions||[]).includes(session.id)) return;
      progressExtrasRef.current={...progressExtrasRef.current,completedSessions:[...(progressExtrasRef.current.completedSessions||[]),session.id]};
      const st=speedStats(session.answers);
      setSpeedScore(st.points);setSpeedAnswered(st.answered);setSpeedCorrect(st.correct);setSpeedBestCombo(st.bestCombo);
      setBestSpeedScore(b=>Math.max(b,st.points));setBestSpeedCombo(b=>Math.max(b,st.bestCombo));
      if(st.answered)recordStudyDay();
      setActiveSession(null);setScreen("speedResults");return;
    }
    if(session.completed || (progressExtrasRef.current.completedSessions||[]).includes(session.id)) return;
    progressExtrasRef.current={...progressExtrasRef.current,completedSessions:[...(progressExtrasRef.current.completedSessions||[]),session.id]};
    if(session.queue.length && session.answers.length===session.queue.length){
      const logEntry={id:session.id,kind:session.kind,title:session.title||session.kind,correct:session.answers.filter(a=>a.correct).length,total:session.queue.length,at:Date.now()};
      const nextLogs=[logEntry,...(progressExtrasRef.current.sessionLogs||[])].slice(0,50);
      progressExtrasRef.current={...progressExtrasRef.current,sessionLogs:nextLogs};setSessionLogs(nextLogs);
    }
    const next = V2.sessionEvidence(masteryRef.current, session);
    masteryRef.current = next; setMastery(next); recordStudyDay();
    if(session.kind==="practice" && session.queue.length && session.answers.length===session.queue.length) {
      const level=LEVELS.find(l=>l.title===session.title);
      if(level){const accuracy=session.answers.filter(a=>a.correct).length/session.queue.length*100;setLevelStats(prev=>({...prev,[level.id]:updateLevelStat(prev[level.id],accuracy)}));if(accuracy>=70)setLevelsCleared(prev=>[...new Set([...prev,level.id])]);}
    }
    if(session.kind==="story" && session.sourceStoryId && session.queue.length && session.answers.length===session.queue.length) {
      const correct=session.answers.filter(a=>a.correct).length,total=session.queue.length;
      const existing=(progressExtrasRef.current.solvedStories||[]).filter(e=>e&&e.id);
      const prior=existing.find(e=>e.id===session.sourceStoryId);
      // Keep the best attempt so far so the story list shows your high score, not whatever the last replay happened to be.
      const record=(!prior||correct>prior.correct)?{id:session.sourceStoryId,correct,total}:prior;
      const nextSolved=[...existing.filter(e=>e.id!==session.sourceStoryId),record];
      progressExtrasRef.current={...progressExtrasRef.current,solvedStories:nextSolved};setSolvedStories(nextSolved);
    }
    setActiveSession({...session,completed:true});
    if(session.kind==="finalRecall") {
      const graded=session.answers.filter(answer=>answer&&!answer.reported&&!answer.aiFailed);
      const correct=graded.filter(answer=>answer.correct&&!answer.assisted).length;
      setFinalRecallSummary({accuracy:graded.length?correct/graded.length*100:0,correct,total:graded.length});
      setScreen("finalReport");
    }
  }
  function reportSessionQuestion(q, session, reason, learnerAnswer, details) {
    markSentencesSeen(q);
    const report={id:`rep-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,questionId:q.id,sessionId:session.id,prompt:q.prompt,targetWords:q.targets||[],mode:q.mode,type:q.type||null,options:q.options||null,answers:q.answers||null,poolType:q.poolType||null,poolItemId:q.poolItemId||null,reason:reason||null,details:details||null,learnerAnswer:learnerAnswer??null,at:Date.now()};
    const merged=[...(progressExtrasRef.current.reports||[]),report];
    // Unbounded growth here was pushing the saved payload toward the
    // storage size limit over months of testing. Keep every unresolved
    // report (still needs action) plus the most recent 150 resolved ones;
    // older resolved history isn't actionable and doesn't need to persist.
    const unresolved=merged.filter(r=>!r.resolvedAt);
    const resolved=merged.filter(r=>r.resolvedAt).slice(-150);
    const reports=[...resolved,...unresolved];
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
    return report;
  }
  // Older saved reports have no id, so object identity stays the fallback.
  function sameReport(a,b){return a===b||(!!a?.id&&a.id===b?.id);}
  // AI triage for one report. Stores the review on the report (so Admin sees
  // the verdict and any drafted fix) and returns it for the learner's view.
  async function reviewQuestionReport(report){
    const review=await reviewReportedQuestion(report,locateReportSource(liveContent(),report));
    const reports=(progressExtrasRef.current.reports||[]).map(item=>sameReport(item,report)?{...item,aiReview:review}:item);
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
    return review;
  }
  function deleteQuestionReport(report){
    const reports=(progressExtrasRef.current.reports||[]).filter(item=>!sameReport(item,report));
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
  }
  function resolveQuestionReport(report){
    const reports=(progressExtrasRef.current.reports||[]).map(item=>sameReport(item,report)?{...item,resolvedAt:Date.now()}:item);
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);setActiveSession(session=>session?{...session}:session);
  }
  function retireReportedVariant(report){
    const wordObj=V2.findWord(WORDS,report.targetWords?.[0]);
    if(!wordObj||!report.poolType||!report.poolItemId){resolveQuestionReport(report);return;}
    const snapshot=poolsRef.current, wordPools=getWordPools(snapshot,wordObj);
    const items=wordPools[report.poolType].map(item=>item.id===report.poolItemId?{...item,flagged:true,lockedUntil:Date.now()+100*365*86400000}:item);
    const nextWordPools={...wordPools,[report.poolType]:items},nextPools={...snapshot,[wordObj.word]:nextWordPools};
    poolsRef.current=nextPools;setPools(nextPools);triggerGeneration([{word:wordObj.word,poolType:report.poolType}],nextPools);resolveQuestionReport(report);
  }
  function updateWordFields(wordName, patch) {
    const next = customWords.map((w) => (V2.norm(w.word) === V2.norm(wordName) ? { ...w, ...patch } : w));
    mergeCustomData(next, customGrammar, customChallenges, LEVEL_ORDER);
    setCustomWords(next);
    setDataVersion((v) => v + 1);
  }
  // A v3 import can rename a word (same id, new spelling) or a category
  // (same id, new title). Progress is keyed by those names, so move it:
  // mastery, content pools, confusion pairs and report targets for words;
  // level stats and cleared levels for categories.
  function migrateRenamedProgress(renames){
    if(!renames||(!renames.words.length&&!renames.categories.length))return;
    const wmap=new Map(renames.words.map(r=>[r.from,r.to]));
    const moveKeys=obj=>{const next={...obj};for(const [from,to] of wmap){if(from in next){if(!(to in next))next[to]=next[from];delete next[from];}}return next;};
    if(wmap.size){
      const m=moveKeys(masteryRef.current);masteryRef.current=m;setMastery(m);
      const p=moveKeys(poolsRef.current);poolsRef.current=p;setPools(p);
      const c={};for(const [key,val] of Object.entries(confusionsRef.current||{})){const [a,b]=key.split("|");c[`${wmap.get(a)||a}|${wmap.get(b)||b}`]=val;}
      confusionsRef.current=c;setConfusions(c);
      const reports=(progressExtrasRef.current.reports||[]).map(r=>({...r,targetWords:(r.targetWords||[]).map(t=>wmap.get(t)||t)}));
      progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
    }
    if(renames.categories.length){
      const cmap=new Map(renames.categories.map(r=>[`cat-${r.from}`,`cat-${r.to}`]));
      setLevelStats(prev=>{const next={...prev};for(const [from,to] of cmap){if(from in next){if(!(to in next))next[to]=next[from];delete next[from];}}return next;});
      setLevelsCleared(prev=>[...new Set(prev.map(id=>cmap.get(id)||id))]);
    }
  }
  // Merge category names in one pass over every content list and the level
  // order, so no empty duplicate level is left behind (the old per-list
  // merge moved the items but kept the old level).
  function mergeCategories(canonical, duplicates){
    const dup=new Set(duplicates.filter(name=>name!==canonical));
    if(!dup.size)return;
    const remap=item=>dup.has(item.category)?{...item,category:canonical}:item;
    const nextWords=customWords.map(remap),nextGrammar=customGrammar.map(remap),nextChallenges=customChallenges.map(remap),nextCombos=customCombos.map(remap),nextStories=customStories.map(remap);
    let order=[...LEVEL_ORDER];
    if(!order.includes(canonical)){const at=order.findIndex(t=>dup.has(t));order.splice(at<0?order.length:at,0,canonical);}
    order=order.filter(t=>!dup.has(t));
    setCustomWords(nextWords);setCustomGrammar(nextGrammar);setCustomChallenges(nextChallenges);setCustomCombos(nextCombos);setCustomStories(nextStories);
    mergeCustomData(nextWords,nextGrammar,nextChallenges,order);setDataVersion(value=>value+1);
  }
  function removeEmptyLevels(){
    const used=new Set([...customWords,...customGrammar,...customChallenges,...customCombos,...customStories].map(item=>item.category).filter(Boolean));
    const order=LEVEL_ORDER.filter(title=>used.has(title));
    const removed=LEVEL_ORDER.length-order.length;
    if(removed){mergeCustomData(customWords,customGrammar,customChallenges,order);setDataVersion(value=>value+1);}
    return removed;
  }
  function updateAdminContent(field,nextList){
    if(field==="levels"){
      const current=LEVEL_ORDER.map(title=>({id:`cat-${title}`,title}));
      const nextById=new Map(nextList.filter(level=>level.id).map(level=>[level.id,level.title]));
      const deleted=new Set(current.filter(level=>!nextById.has(level.id)).map(level=>level.title));
      const renamed=new Map(current.filter(level=>nextById.has(level.id)&&nextById.get(level.id)!==level.title).map(level=>[level.title,nextById.get(level.id)]));
      const adjust=item=>deleted.has(item.category)?null:renamed.has(item.category)?{...item,category:renamed.get(item.category)}:item;
      const nextWords=customWords.map(adjust).filter(Boolean),nextGrammar=customGrammar.map(adjust).filter(Boolean),nextChallenges=customChallenges.map(adjust).filter(Boolean);
      const nextCombos=customCombos.map(adjust).filter(Boolean),nextStories=customStories.map(adjust).filter(Boolean);
      const nextOrder=nextList.map(level=>String(level.title||"").trim()).filter(Boolean);
      setCustomWords(nextWords);setCustomGrammar(nextGrammar);setCustomChallenges(nextChallenges);setCustomCombos(nextCombos);setCustomStories(nextStories);
      mergeCustomData(nextWords,nextGrammar,nextChallenges,nextOrder);setDataVersion(value=>value+1);return;
    }
    const nextWords=field==="words"?nextList:customWords;
    const nextGrammar=field==="grammar"?nextList:customGrammar;
    const nextChallenges=field==="challenges"?nextList:customChallenges;
    if(field==="words")setCustomWords(nextList);
    if(field==="grammar")setCustomGrammar(nextList);
    if(field==="challenges")setCustomChallenges(nextList);
    if(field==="combos")setCustomCombos(nextList);
    if(field==="stories")setCustomStories(nextList);
    mergeCustomData(nextWords,nextGrammar,nextChallenges,LEVEL_ORDER);
    setDataVersion(value=>value+1);
  }

  const [dataVersion, setDataVersion] = useState(0); // bumped whenever WORDS/GRAMMAR/LEVELS change
  const [confirmAction, setConfirmAction] = useState(null); // null | 'reset' | 'wipe'
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState(null); // null | level object

  function deleteLevelCategory(level) {
    const nextOrder = LEVEL_ORDER.filter((t) => t !== level.title).map((t) => ({ id: `cat-${t}`, title: t }));
    updateAdminContent("levels", nextOrder);
  }
  const [customWords, setCustomWords] = useState([]);
  const [customGrammar, setCustomGrammar] = useState([]);
  const [customChallenges, setCustomChallenges] = useState([]);
  const [contentPanelView, setContentPanelView] = useState("review"); // 'export' | 'review'
  const [exportText, setExportText] = useState("");
  const [exportCopied, setExportCopied] = useState(false);
  const [quickBackupCopied, setQuickBackupCopied] = useState(false);
  const [showFreshCopyPrompt, setShowFreshCopyPrompt] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewPreview, setReviewPreview] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const [aiFixBusy, setAiFixBusy] = useState(false);
  const [aiFixError, setAiFixError] = useState(null);
  const [aiFixChanges, setAiFixChanges] = useState(null);
  const [sessionType, setSessionType] = useState("level");
  const [levelsCleared, setLevelsCleared] = useState([]);
  const [levelStats, setLevelStats] = useState({});
  const [studyStreak, setStudyStreak] = useState(0);
  const [bestStudyStreak, setBestStudyStreak] = useState(0);
  const [lastStudyDate, setLastStudyDate] = useState(null);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(null);
  const [roundQueue, setRoundQueue] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [justCleared, setJustCleared] = useState(false);
  const [lastRoundSummary, setLastRoundSummary] = useState(null);
  const [finalCaseWords, setFinalCaseWords] = useState([]);
  const [finalReportText, setFinalReportText] = useState("");
  const [finalRecallSummary, setFinalRecallSummary] = useState(null);
  const [finalCaseResult, setFinalCaseResult] = useState(null);

  async function openAskAi(term="") {
    const clean=String(term||"").trim().replace(/\s+/g," ").slice(0,80);
    setAskAiOpen(true);setAskAiError(null);setAskAiResult(null);
    if(clean){setAskAiTerm(clean);await runAskAi(clean);}
  }

  async function runAskAi(term=askAiTerm) {
    const clean=String(term||"").trim();if(!clean)return;
    setAskAiBusy(true);setAskAiError(null);setAskAiResult(null);
    try{
      const existing=V2.findWord(WORDS,clean);
      const result=await askAiForWord(clean,existing);
      setAskAiResult({...result,alreadyInCollection:!!(existing||V2.findWord(WORDS,result.word))});
    }catch(error){console.error("Ask AI failed",error);setAskAiError(error.message||"AI explanation is unavailable. Try again.");}
    finally{setAskAiBusy(false);}
  }

  function addAiWord() {
    if(!askAiResult||askAiResult.alreadyInCollection)return;
    // Prefer the category the player is currently standing on (the level
    // they're playing, or a practice session's category) over whatever
    // category the AI guessed — keeps newly-added words in context.
    const contextCategory=currentLevel?.title||(activeSession?.kind==='practice'?activeSession.title:null);
    const entry={word:askAiResult.word,type:askAiResult.type,...(askAiResult.partsOfSpeech?.length?{partsOfSpeech:askAiResult.partsOfSpeech}:{}),category:contextCategory||askAiResult.category||"AI Discoveries",meaning:askAiResult.meaning,situation:askAiResult.situation,gap:askAiResult.gap,hints:askAiResult.hints||[],_aiAdded:true,...(askAiResult.commonMistake?{commonMistake:askAiResult.commonMistake}:{})};
    if(/[\u0600-\u06FF]/.test(JSON.stringify(entry))){setAskAiError("The generated card contains non-English text. Regenerate it before adding.");return;}
    const errors=V2.validateContent({schemaVersion:2,kind:"content",words:[entry]},liveContent());
    if(errors.length){setAskAiError(`Cannot add this card: ${errors[0]}`);return;}
    const next=[...customWords,entry];
    mergeCustomData(next,customGrammar,customChallenges,LEVEL_ORDER);
    setCustomWords(next);setDataVersion(value=>value+1);
    setAskAiResult(previous=>({...previous,alreadyInCollection:true}));
    setToast({kind:"import",text:`${entry.word} added to your collection`});
  }

  // Speed Round — a timed review of mastered words. It plays in the normal
  // question box (SessionView, kind "speed"); these hold the last result.
  const [speedScore, setSpeedScore] = useState(0);
  const [speedAnswered, setSpeedAnswered] = useState(0);
  const [speedCorrect, setSpeedCorrect] = useState(0);
  const [speedBestCombo, setSpeedBestCombo] = useState(0);
  const [bestSpeedScore, setBestSpeedScore] = useState(0);
  const [bestSpeedCombo, setBestSpeedCombo] = useState(0);

  const [selected, setSelected] = useState(null);
  const [selectedMulti, setSelectedMulti] = useState([]);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const [availableTokens, setAvailableTokens] = useState([]);
  const [orderedTokens, setOrderedTokens] = useState([]);
  const [challengeStepIndex, setChallengeStepIndex] = useState(0);
  const [challengeStepResults, setChallengeStepResults] = useState([]);
  const [stepAnswer, setStepAnswer] = useState("");
  const [stepFeedback, setStepFeedback] = useState(null);
  const [feedbackDetail, setFeedbackDetail] = useState(null);
  const [aiEvaluation, setAiEvaluation] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [grammarCorrectionResult, setGrammarCorrectionResult] = useState(null);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [mastery, setMastery] = useState({});
  const [pools, setPools] = useState({});
  const [confusions, setConfusions] = useState({});

  const badgesOpen = screen === "badges", dashboardOpen = screen === "stats", importOpen = screen === "data";
  const [toast, setToast] = useState(null);
  const seenBadgesRef = useRef(null);
  const pendingGenRef = useRef(new Set());
  const poolsRef = useRef(pools);
  const masteryRef = useRef(mastery);
  const confusionsRef = useRef(confusions);
  const roundCorrectRef = useRef(0);
  const roundTotalRef = useRef(0);
  const roundStartStagesRef = useRef({});
  const studyRef = useRef({ studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null });
  const reviewFileInputRef = useRef(null);
  const feedbackRequestIdRef = useRef(0);
  useEffect(() => { poolsRef.current = pools; }, [pools]);
  useEffect(() => { masteryRef.current = mastery; }, [mastery]);
  useEffect(() => { confusionsRef.current = confusions; }, [confusions]);
  useEffect(() => { studyRef.current = { studyStreak, bestStudyStreak, lastStudyDate }; }, [studyStreak, bestStudyStreak, lastStudyDate]);

  const clearedSet = useMemo(() => new Set(levelsCleared), [levelsCleared]);
  const weakCandidates = useMemo(() => getWeakWordCandidates(WORDS, mastery, confusions), [mastery, confusions, dataVersion]);
  const masteredOnlyWords = useMemo(() => WORDS.filter((w) => getMasteryStage(mastery[w.word], { kind: "word", obj: w }) === MASTERY_STAGE.MASTERED), [mastery, dataVersion]);
  const stageSummary = useMemo(() => { const counts = { New: 0, Familiar: 0, Learned: 0, Mastered: 0 }; LEVELS.forEach((level) => level.items.forEach((item) => { counts[getMasteryStage(mastery[levelItemKey(item)], item)] += 1; })); return counts; }, [mastery, dataVersion]);
  const overviewStats = useMemo(() => {
    let total = 0, practiced = 0, correctSum = 0, totalSum = 0;
    LEVELS.forEach((level) => level.items.forEach((item) => {
      total += 1;
      const stats = mastery[levelItemKey(item)];
      const attempts = stats?.total || 0;
      if (attempts > 0) practiced += 1;
      correctSum += stats?.correct || 0;
      totalSum += attempts;
    }));
    return { total, practiced, accuracy: totalSum > 0 ? Math.round((correctSum / totalSum) * 100) : null };
  }, [mastery, dataVersion]);
  const learningInsights = useMemo(() => deriveLearningInsights(WORDS, mastery, confusions), [mastery, confusions, dataVersion]);
  const currentLevel = currentLevelIndex !== null ? LEVELS[currentLevelIndex] : null;
  const currentEntry = roundQueue[roundIndex] || null;
  // Built once per case, not per pools update — otherwise answering (which
  // updates pools) would reshuffle this very question's own options.
  const question = useMemo(
    () => (currentEntry ? buildEntryQuestion(currentEntry, poolsRef.current) : null),
    [currentEntry]
  );

  useEffect(() => {
    setAvailableTokens(
      question?.type === "wordOrder"
        ? shuffle(question.tokens || []).map((text, index) => ({ id: `${index}-${text}`, text }))
        : []
    );
    setOrderedTokens([]);
    setChallengeStepIndex(0);
    setChallengeStepResults([]);
    setStepAnswer("");
    setStepFeedback(null);
  }, [question]);

  function getLevelStars(levelId) {
    return Math.max(Number(levelStats[levelId]?.stars || 0), clearedSet.has(levelId) ? 1 : 0);
  }

  function isLevelUnlocked(index) {
    return true; // TEMP: all levels unlocked for testing — revert to real progression below when ready
    if (index === 0) return true;
    const level = LEVELS[index];
    const previous = LEVELS[index - 1];
    return getLevelStars(previous.id) >= 1 || getLevelStars(level.id) >= 1;
  }

  function recordStudyDay() {
    const prev = studyRef.current;
    const next = nextStudyStreakState(prev.lastStudyDate, prev.studyStreak, prev.bestStudyStreak);
    studyRef.current = next;
    setStudyStreak(next.studyStreak);
    setBestStudyStreak(next.bestStudyStreak);
    setLastStudyDate(next.lastStudyDate);
  }

  function snapshotStages(items) {
    const snapshot = {};
    items.forEach((item) => { const key = levelItemKey(item); snapshot[key] = getMasteryStage(masteryRef.current[key], item); });
    return snapshot;
  }

  // Fires a background content-generation request for the given
  // (word, poolType) pairs and merges the results into the pools once ready.
  // Never blocks the UI — if it fails, the game just keeps reusing what it has.
  async function triggerGeneration(batch, poolsSnapshot) {
    const filtered = batch.filter((b) => !pendingGenRef.current.has(`${b.word}::${b.poolType}`));
    if (!filtered.length) return;
    filtered.forEach((b) => pendingGenRef.current.add(`${b.word}::${b.poolType}`));
    try {
      const results = await generateContent(filtered, poolsSnapshot);
      setPools((prev) => {
        const next = { ...prev };
        for (const item of results) {
          const wordObj = WORDS.find((w) => w.word === item.word);
          if (!wordObj || !item.text) continue;
          const wp = getWordPools(next, wordObj);
          const newItem = {
            id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: item.text,
            attempts: 0,
            correctCount: 0,
            lockedUntil: null,
            flagged: false,
          };
          next[item.word] = { ...wp, [item.poolType]: [...wp[item.poolType], newItem] };
        }
        return next;
      });
    } catch (e) {
      console.error("Content generation failed:", e);
    } finally {
      filtered.forEach((b) => pendingGenRef.current.delete(`${b.word}::${b.poolType}`));
    }
  }

  // Same idea as triggerGeneration above, but for combo/grammar "variant"
  // pools (progressKey-keyed, not word-keyed) — fires once a combo/grammar
  // question's pool has no fresh (unlocked) item left, i.e. it's just been
  // answered correctly twice.
  async function triggerVariantGeneration(poolType, key) {
    const genKey = `variant::${poolType}::${key}`;
    if (pendingGenRef.current.has(genKey)) return;
    pendingGenRef.current.add(genKey);
    try {
      const id = key.slice(key.indexOf(":") + 1);
      const content = liveContent();
      if (poolType === "combo") {
        const combo = (content.combos || []).find((c) => c.id === id);
        if (!combo) return;
        const variant = await generateComboVariant(combo);
        setPools((prev) => {
          const existing = prev[key]?.variant?.length ? prev[key].variant : [];
          const newItem = { id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, situation: variant.situation, prompt: variant.prompt, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
          const next = { ...prev, [key]: { ...prev[key], variant: [...existing, newItem] } };
          poolsRef.current = next;
          return next;
        });
      } else if (poolType === "grammar") {
        const g = (content.grammar || []).find((x) => x.id === id);
        if (!g) return;
        const variant = await generateGrammarVariant(g);
        setPools((prev) => {
          const existing = prev[key]?.variant?.length ? prev[key].variant : [];
          const newItem = { id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, prompt: variant.prompt, options: variant.options, answer: variant.answer, explanation: variant.explanation, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
          const next = { ...prev, [key]: { ...prev[key], variant: [...existing, newItem] } };
          poolsRef.current = next;
          return next;
        });
      }
    } catch (e) {
      console.error("Variant generation failed:", e);
    } finally {
      pendingGenRef.current.delete(genKey);
    }
  }

  // Load saved progress AND any previously imported custom content once on
  // mount. Custom content must be merged first so LEVELS/BADGES are already
  // correct by the time we compute badge state from the saved mastery.
  // A failed load stops here (with a retry) instead of starting from empty
  // progress, which the next save would otherwise write over the real one.
  useEffect(() => {
    (async () => {
      let levelOrder = LEVEL_ORDER;
      let hadAnyData = false;
      let custom = null, raw = null;
      try {
        [custom, raw] = await Promise.all([repo.loadContent(), repo.loadProgress()]);
      } catch (e) {
        console.error("Could not load game data:", e);
        setLoadError(e?.message || "Network error");
        return;
      }
      if (custom) {
        hadAnyData = true;
        custom = V2.withoutRemovedFields(custom);
        setCustomCombos(custom.combos || []); setCustomStories(custom.stories || []); contentNoteRef.current=custom.note||"";
        setCustomWords(custom.words || []);
        setCustomGrammar(custom.grammar || []);
        setCustomChallenges(Array.isArray(custom.challenges) ? custom.challenges : []);
        levelOrder = custom.levelOrder || LEVEL_ORDER;
        mergeCustomData(custom.words || [], custom.grammar || [], custom.challenges || [], levelOrder);
      }

      try {
        if (raw) hadAnyData = true;
        const data = raw ? migrateProgressData(raw) : emptyProgressData();
        progressExtrasRef.current = data; setActiveSession(data.activeSession || null);setDailyProgress(data.dailyProgress||null);setQuestionReports(Array.isArray(data.reports)?data.reports:[]);setSolvedStories(Array.isArray(data.solvedStories)?data.solvedStories:[]);setSessionLogs(Array.isArray(data.sessionLogs)?data.sessionLogs:[]);
        setScore(data.score); setStreak(data.streak); setBestStreak(data.bestStreak); setAttempted(data.attempted);
        setMastery(data.mastery); masteryRef.current = data.mastery;
        setLevelsCleared(data.levelsCleared); setLevelStats(data.levelStats); setPools(data.pools); poolsRef.current = data.pools;
        setStudyStreak(data.studyStreak); setBestStudyStreak(data.bestStudyStreak); setLastStudyDate(data.lastStudyDate);
        studyRef.current = { studyStreak: data.studyStreak, bestStudyStreak: data.bestStudyStreak, lastStudyDate: data.lastStudyDate };
        setBestSpeedScore(data.bestSpeedScore); setBestSpeedCombo(data.bestSpeedCombo);
        setConfusions(data.confusions); confusionsRef.current = data.confusions;
        setSettings(normalizeSettings(data.settings));
        seenBadgesRef.current = new Set(BADGES.filter((b) => getBadgeProgress(b, { mastery: data.mastery, bestStreak: data.bestStreak }).earned).map((b) => b.id));
      } catch (e) {
        console.error("Could not read progress:", e);
        seenBadgesRef.current = new Set();
      } finally {
        setDataVersion((v) => v + 1);
        setLoaded(true);
        // Only the admin can bring content in; a player with no content just sees empty levels.
        if (!hadAnyData && isAdmin) setShowFreshCopyPrompt(true);
      }
    })();
  }, [repo]);

  // Save progress whenever it changes (after initial load). Debounced so a
  // burst of typing collapses into one save; the repo sends only what
  // changed and queues the newest state while a save is in flight.
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => {
      repo.saveProgress({ ...progressExtrasRef.current, activeSession, schemaVersion: SCHEMA_VERSION, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings })
        .catch((e) => console.error("Could not save progress:", e));
    }, 600);
    return () => clearTimeout(handle);
  }, [loaded, activeSession, questionReports, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings, liveSeenTick]);

  // Save content whenever it changes (admin only — players read content,
  // they never write it). Separate from progress so a progress reset never
  // touches imported vocabulary.
  const contentSavingRef = useRef(Promise.resolve());
  useEffect(() => {
    if (!loaded || !isAdmin) return;
    const handle = setTimeout(() => {
      const content = { note: contentNoteRef.current, combos: customCombos, stories: customStories, words: customWords, grammar: customGrammar, challenges: customChallenges, levelOrder: LEVEL_ORDER };
      contentSavingRef.current = contentSavingRef.current.then(() => repo.saveContent(content)).catch((e) => {
        console.error("Could not save content:", e);
        setStorageWarning("Content could not be saved to the server. Check your connection; your last change will be saved with the next edit. Take a Full Backup if this keeps happening.");
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [loaded, customCombos, customStories, customWords, customGrammar, customChallenges, dataVersion]);

  // Detect newly earned badges and surface a small celebration toast
  useEffect(() => {
    if (!loaded || !seenBadgesRef.current) return;
    for (const badge of BADGES) {
      const { earned } = getBadgeProgress(badge, { mastery, bestStreak });
      if (earned && !seenBadgesRef.current.has(badge.id)) {
        seenBadgesRef.current.add(badge.id);
        setToast({ kind: "badge", text: badge.label });
      }
    }
  }, [mastery, bestStreak, loaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(()=>{if(!askAiOpen)return;const close=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setAskAiOpen(false);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[askAiOpen]);

  // group (optional): one subCategory of the lesson, from levelGroups().
  function startLevel(index, group = null) {
    const level = LEVELS[index]; if(!level) return;
    setCurrentLevelIndex(index);
    const sessionTitle = group ? `${level.title} · ${group.title}` : level.title;
    // New-word intake follows the last round in this level: a strong round
    // (90%+) earns two extra new words, a rough one (under 60%) holds back
    // two so the missed words get room. 0 in Settings still means none.
    const lastRound = sessionLogs.find((log) => log.kind === "practice" && log.title === sessionTitle && log.total > 0);
    const lastAccuracy = lastRound ? lastRound.correct / lastRound.total : null;
    const baseNew = settings.newWordsPerRound;
    const newWordsPerRound = baseNew === 0 || lastAccuracy === null ? baseNew : lastAccuracy >= 0.9 ? Math.min(10, baseNew + 2) : lastAccuracy < 0.6 ? Math.max(1, baseNew - 2) : baseNew;
    const session = V2.practice(liveContent(), masteryRef.current, level.title, Math.random, reportQuarantine, { questionsPerRound: settings.questionsPerRound, newWordsPerRound, pools: poolsRef.current, extraQuestion: buildPracticeExtra, confusions: confusionsRef.current, seen: progressExtrasRef.current.seenSentences || {}, ...(group ? { title: sessionTitle, ...(group.id ? { [group.field === "unit" ? "unit" : "subCategory"]: group.id } : { noGroup: group.field }) } : {}) });
    // Words whose gap sentences have all been read get new ones written now,
    // so the next rounds have fresh sentences instead of shrinking.
    const seenNow = progressExtrasRef.current.seenSentences || {};
    const exhausted = WORDS.filter((w) => w.category === level.title && V2.known(masteryRef.current[w.word]) && /_{2,}/.test(w.gap || "") && V2.poolItems(w, "gap", poolsRef.current?.[w.word]?.gap).every((it) => V2.seenRecently(seenNow, it.text))).slice(0, 8);
    if (exhausted.length) triggerGeneration(exhausted.map((w) => ({ word: w.word, poolType: "gap" })), poolsRef.current);
    if (newWordsPerRound > baseNew && session.introductions.length > baseNew) setToast({ text: `Strong last round here — ${session.introductions.length} new words this time.` });
    launchSession(session);
  }
  function startWeakReview() {
    const picked = weakCandidates.slice(0, settings.weakReviewSize);
    if (!picked.length) return;
    let lastWord = null;
    let lastMode = null;
    const queue = picked.map(({ word, stats }) => {
      let mode = pickWeakMode(word, stats, confusionsRef.current, reportQuarantine);
      if (mode === lastMode && !getWeakWordCandidates([word], { [word.word]: stats }, confusionsRef.current)[0]?.weakModes?.includes(mode)) {
        mode = selectAdaptiveMode(word, stats, { sessionType: "weak", confusion: getStrongConfusion(word, confusionsRef.current), lastMode, quarantine: reportQuarantine });
      }
      const entry = { kind: "word", wordObj: word, mode, difficulty: getAdaptiveDifficulty(word, stats, mode), confusionPartner: getStrongConfusion(word, confusionsRef.current)?.partner || null };
      lastWord = word.word; lastMode = mode;
      return entry;
    }).filter((entry, i, arr) => i === 0 || entry.wordObj.word !== arr[i - 1].wordObj.word);
    setCurrentLevelIndex(null);
    roundStartStagesRef.current = snapshotStages(queue.map((entry) => ({ kind: "word", obj: entry.wordObj })));
    setPoolsSnapshotForSession(poolsRef.current);
    launchSession(v2SessionFromEntries(queue,{kind:"weak",title:"Weak Evidence",idPrefix:"weak"}));
  }

  function startFinalCase(index) {
    const level = LEVELS[index];
    if (!level || getLevelStars(level.id) < 1) return;
    const wordItems = level.items.filter((item) => item.kind === "word");
    if (!wordItems.length) return;
    const priority = { Learned: 0, Familiar: 1, New: 2, Mastered: 3 };
    const selectedItems = shuffle(wordItems).sort((a, b) => {
      const aStage = getMasteryStage(masteryRef.current[levelItemKey(a)], a);
      const bStage = getMasteryStage(masteryRef.current[levelItemKey(b)], b);
      return priority[aStage] - priority[bStage];
    }).slice(0, Math.min(3, wordItems.length));
    const selectedWords = selectedItems.map((item) => item.obj);
    setCurrentLevelIndex(index);
    setFinalCaseWords(selectedWords);
    setFinalReportText("");
    setFinalRecallSummary(null);
    setFinalCaseResult(null);
    roundStartStagesRef.current = snapshotStages(selectedItems);
    setPoolsSnapshotForSession(poolsRef.current);
    launchSession(v2SessionFromEntries(selectedWords.map((wordObj)=>({kind:"word",wordObj,mode:"gapTyping",difficulty:4})),{kind:"finalRecall",title:`Final Case — ${level.title}`,idPrefix:"final"}));
  }

  function launchAuthoredChallenge(challenge) {
    setCurrentLevelIndex(null);
    setPoolsSnapshotForSession(poolsRef.current);
    launchSession(v2SessionFromEntries([{kind:"challenge",obj:challenge}],{kind:"challenge",title:challenge.label||challenge.id,idPrefix:`challenge-${challenge.id}`}));
  }

  function retryLevel() { if (currentLevelIndex !== null) startLevel(currentLevelIndex); }
  function backToLevels() { setScreen("levels"); setCurrentLevelIndex(null); setSessionType("level"); }

  function learningDelta(items) {
    let improved = 0;
    let masteredGained = 0;
    items.filter((item) => item.kind === "word").forEach((item) => {
      const key = levelItemKey(item);
      const before = roundStartStagesRef.current[key] || MASTERY_STAGE.NEW;
      const after = getMasteryStage(masteryRef.current[key], item);
      if (MASTERY_STAGE_RANK[after] > MASTERY_STAGE_RANK[before]) improved += 1;
      if (after === MASTERY_STAGE.MASTERED && before !== MASTERY_STAGE.MASTERED) masteredGained += 1;
    });
    const weakCount = getWeakWordCandidates(items.filter((x) => x.kind === "word").map((x) => x.obj), masteryRef.current, confusionsRef.current).length;
    return { improved, masteredGained, weakCount };
  }

  function trackConfusion(targetWord, selectedValue) {
    const selectedWord = findWordByLabel(selectedValue);
    if (!targetWord || !selectedWord || selectedWord.word === targetWord.word) return;
    const key = `${targetWord.word}|${selectedWord.word}`;
    const prevAll = confusionsRef.current || {};
    const prev = prevAll[key];
    const next = pruneConfusions({ ...prevAll, [key]: { count: confusionCount(prev) + 1, lastAt: Date.now() } });
    confusionsRef.current = next;
    setConfusions(next);
  }

  function registerResult(correct, meta = {}) {
    if (!question) return;
    const now = Date.now();
    const key = question.target.key;
    const modeId = question.modeId || question.poolType || (question.type === "typing" ? "typing" : "unknown");
    const isChallenge = String(key).startsWith("challenge:");
    const isWord = !String(key).startsWith("grammar:") && !String(key).startsWith("pun:") && !isChallenge;
    const roundCorrect = meta.roundCorrect !== undefined ? meta.roundCorrect : correct;
    const masteryCorrect = !question.hint && (meta.masteryCorrect !== undefined ? meta.masteryCorrect : correct);

    setAttempted((n) => n + 1);
    roundTotalRef.current += 1; setRoundTotal(roundTotalRef.current);
    if (roundCorrect) { roundCorrectRef.current += 1; setRoundCorrect(roundCorrectRef.current); }
    setStreak((s) => { const next = roundCorrect ? s + 1 : 0; setBestStreak((best) => Math.max(best, next)); return next; });
    setScore((scoreValue) => roundCorrect ? scoreValue + 10 : scoreValue);

    const prevMastery = masteryRef.current;
    let progressionEligible = meta.skipProgression !== true;
    if (progressionEligible && isWord && question.poolType && question.poolItemId) {
      const displayedVariant = getWordPools(poolsRef.current, question.target)[question.poolType]?.find((it) => it.id === question.poolItemId);
      progressionEligible = !(displayedVariant?.lockedUntil && displayedVariant.lockedUntil > now);
    }

    if (progressionEligible) {
      const prev = normalizeMasteryRecord(prevMastery[key]);
      const prevMode = normalizeModeStats(prev.modes[modeId]);
      const productionAttempt = isWord && PRODUCTION_MODES.has(modeId);
      const genuineProduction = productionAttempt && masteryCorrect && meta.productionSuccess !== false;
      const streak = isWord ? updateReviewStreak(prev, masteryCorrect, now, { productionNow: genuineProduction }) : { lastReviewedAt: now };
      const sentenceAttempt = modeId === "finalReport";
      const regressionStrikes = prev.everMastered
        ? (masteryCorrect ? Math.max(0, prev.regressionStrikes - 1) : prev.regressionStrikes + 1)
        : prev.regressionStrikes;
      let nextRecord = {
        ...prev,
        assistedAttempts: Number(prev.assistedAttempts || 0) + (question.hint ? 1 : 0),
        correct: prev.correct + (masteryCorrect ? 1 : 0),
        total: prev.total + 1,
        modes: { ...prev.modes, [modeId]: { ...prevMode, correct: prevMode.correct + (masteryCorrect ? 1 : 0), total: prevMode.total + 1, spellingMisses: prevMode.spellingMisses + (meta.spellingIssue ? 1 : 0), lastResult: masteryCorrect ? "correct" : meta.spellingIssue ? "spelling" : "wrong", lastDifficulty: Number(question.difficulty || 1) } },
        productionCorrect: prev.productionCorrect + (genuineProduction ? 1 : 0),
        productionAttempts: prev.productionAttempts + (productionAttempt ? 1 : 0),
        spellingMisses: prev.spellingMisses + (meta.spellingIssue ? 1 : 0),
        sentenceAttempts: prev.sentenceAttempts + (sentenceAttempt ? 1 : 0),
        sentenceSuccesses: prev.sentenceSuccesses + (sentenceAttempt && genuineProduction ? 1 : 0),
        aiEvaluatedAttempts: prev.aiEvaluatedAttempts + (meta.aiEvaluated ? 1 : 0),
        lastResult: masteryCorrect ? "correct" : meta.spellingIssue ? "spelling" : "wrong",
        regressionStrikes,
        recentResults: [...prev.recentResults, { correct: masteryCorrect, modeId, difficulty: Number(question.difficulty || 1), at: now, spelling: !!meta.spellingIssue }].slice(-RECENT_RESULT_LIMIT),
        ...streak,
      };
      if (getMasteryStage(nextRecord, { kind: isWord ? "word" : "grammar", obj: question.target }) === MASTERY_STAGE.MASTERED) nextRecord.everMastered = true;
      let nextMastery = { ...prevMastery, [key]: nextRecord };
      if (isChallenge && Array.isArray(question.linkedWords)) {
        question.linkedWords.filter(label => [question.answer, ...(question.correctAnswers || [])].some(answer => V2.norm(answer) === V2.norm(label))).forEach((linkedWord) => {
          const wordObj = WORDS.find((word) => word.word === linkedWord);
          if (!wordObj) return;
          const linkedPrev = normalizeMasteryRecord(nextMastery[linkedWord]);
          const linkedMode = normalizeModeStats(linkedPrev.modes[modeId]);
          const linkedProductionAttempt = PRODUCTION_MODES.has(modeId);
          const linkedProductionSuccess = linkedProductionAttempt && masteryCorrect && meta.productionSuccess !== false;
          let linkedRecord = {
            ...linkedPrev,
            correct: linkedPrev.correct + (masteryCorrect ? 1 : 0),
            total: linkedPrev.total + 1,
            modes: {
              ...linkedPrev.modes,
              [modeId]: {
                ...linkedMode,
                correct: linkedMode.correct + (masteryCorrect ? 1 : 0),
                total: linkedMode.total + 1,
                lastResult: masteryCorrect ? "correct" : "wrong",
                lastDifficulty: Number(question.difficulty || 1),
              },
            },
            productionCorrect: linkedPrev.productionCorrect + (linkedProductionSuccess ? 1 : 0),
            productionAttempts: linkedPrev.productionAttempts + (linkedProductionAttempt ? 1 : 0),
            sentenceAttempts: linkedPrev.sentenceAttempts,
            sentenceSuccesses: linkedPrev.sentenceSuccesses,
            lastResult: masteryCorrect ? "correct" : "wrong",
            recentResults: [...linkedPrev.recentResults, { correct: masteryCorrect, modeId, difficulty: Number(question.difficulty || 1), at: now }].slice(-RECENT_RESULT_LIMIT),
            ...updateReviewStreak(linkedPrev, masteryCorrect, now),
          };
          if (getMasteryStage(linkedRecord, { kind: "word", obj: wordObj }) === MASTERY_STAGE.MASTERED) linkedRecord.everMastered = true;
          nextMastery[linkedWord] = linkedRecord;
        });
      }
      masteryRef.current = nextMastery;
      setMastery(nextMastery);
    }

    if (question.poolType && question.poolItemId && isWord) {
      const wordObj = question.target;
      const poolsSnapshot = poolsRef.current;
      const wordPools = getWordPools(poolsSnapshot, wordObj);
      const arr = wordPools[question.poolType].map((it) => {
        if (it.id !== question.poolItemId) return it;
        const attempts = it.attempts + 1;
        const correctCount = it.correctCount + (masteryCorrect ? 1 : 0);
        const lockedUntil = correctCount >= 2 ? now + LOCK_DAYS * 24 * 60 * 60 * 1000 : it.lockedUntil;
        return { ...it, attempts, correctCount, lockedUntil };
      });
      const nextWordPools = { ...wordPools, [question.poolType]: arr };
      const nextPools = { ...poolsSnapshot, [wordObj.word]: nextWordPools };
      poolsRef.current = nextPools; setPools(nextPools);
      if (poolNeedsGeneration(nextWordPools, question.poolType)) triggerGeneration([{ word: wordObj.word, poolType: question.poolType }], nextPools);
    }
    if (isChallenge) setLastChallengeId(question.challengeId);
  }

  function handleSelect(opt) {
    if (status) return;
    setSelected(opt);
    const correct = normalizeAnswerText(opt) === normalizeAnswerText(question.answer);
    const detail = correct ? null : buildContrastiveFeedback(question, opt);
    setFeedbackDetail(detail);
    const confusionTarget = findWordByLabel(question.answer);
    if (!correct && confusionTarget && findWordByLabel(opt)) trackConfusion(confusionTarget, opt);
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct);

    // Ask the AI for a sharper, situation-grounded explanation in the
    // background and swap it in once ready; the static line above stays
    // visible in the meantime so feedback is never empty.
    if (detail) {
      const requestId = ++feedbackRequestIdRef.current;
      const chosenWord = findWordByLabel(opt);
      const correctWord = findWordByLabel(question.answer) || question.target;
      if (chosenWord && correctWord) {
        setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: true } : prev));
        explainWrongLead(question, chosenWord, correctWord)
          .then((text) => {
            if (feedbackRequestIdRef.current !== requestId) return; // a newer question took over
            setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: false, ...(text ? { keyDifference: text } : {}) } : prev));
          })
          .catch(() => {
            if (feedbackRequestIdRef.current !== requestId) return;
            setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: false } : prev));
          });
      }
    }
  }

  function toggleMultiOption(opt) { if (!status) setSelectedMulti((prev) => prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]); }
  function submitMulti() {
    if (status || selectedMulti.length === 0) return;
    const want = question.correctAnswers.map(normalizeAnswerText).sort(), got = selectedMulti.map(normalizeAnswerText).sort();
    const correct = want.length === got.length && want.every((w, i) => w === got[i]);
    setStatus(correct ? "correct" : "wrong"); registerResult(correct);
  }

  function acceptedAnswerMatches(value, accepted = []) {
    const normalized = normalizeAnswerText(value).replace(/[.!?]+$/, "").trim();
    return uniqueStrings(accepted).some((answer) => normalizeAnswerText(answer).replace(/[.!?]+$/, "").trim() === normalized);
  }

  function moveTokenToAnswer(token) {
    if (status) return;
    setAvailableTokens((prev) => prev.filter((item) => item.id !== token.id));
    setOrderedTokens((prev) => [...prev, token]);
  }

  function moveTokenBack(token) {
    if (status) return;
    setOrderedTokens((prev) => prev.filter((item) => item.id !== token.id));
    setAvailableTokens((prev) => [...prev, token]);
  }

  function submitWordOrder() {
    if (status || availableTokens.length || !orderedTokens.length) return;
    const built = orderedTokens.map((token) => token.text).join(" ");
    setTyped(built);
    const accepted = question.acceptedAnswers?.length ? question.acceptedAnswers : [question.answer];
    const correct = accepted.some(answer=>V2.sentence(answer)===V2.sentence(built));
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct, { productionSuccess: correct });
  }

  function submitSelfCheck() {
    if (status || !typed.trim()) return;
    const missing = (question.requiredWords || []).filter((word) => !containsRequiredTerm(typed, word));
    if (missing.length) {
      setStepFeedback({ correct: false, explanation: `Still missing: ${missing.join(", ")}. Revise your sentence and check again.` });
      return;
    }
    setStepFeedback({
      correct: true,
      explanation: "Required words found. This is an objective inclusion check only; compare your sentence with the model example for a self-check.",
    });
    setStatus("correct");
    registerResult(true, { productionSuccess: false, skipProgression: true });
  }

  function submitChallengeStep() {
    if (status || stepFeedback || !question?.steps?.[challengeStepIndex]) return;
    const step = question.steps[challengeStepIndex];
    if (!stepAnswer.trim()) return;
    const correct = acceptedAnswerMatches(stepAnswer, step.acceptedAnswers);
    setStepFeedback({ correct, explanation: step.explanation || (correct ? "Correct." : `Accepted answer: ${step.acceptedAnswers[0] || "—"}`) });
  }

  function advanceChallengeStep() {
    if (!stepFeedback || !question?.steps?.length) return;
    const results = [...challengeStepResults, stepFeedback.correct];
    if (challengeStepIndex + 1 < question.steps.length) {
      setChallengeStepResults(results);
      setChallengeStepIndex((index) => index + 1);
      setStepAnswer("");
      setStepFeedback(null);
      return;
    }
    const correct = results.every(Boolean);
    setChallengeStepResults(results);
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct, { productionSuccess: correct });
  }

  async function submitTyped() {
    if (status || aiBusy || !typed.trim()) return;
    const guess = typed.trim();
    const accepted = question.acceptedAnswers?.length ? question.acceptedAnswers : [question.answer];
    if (acceptedAnswerMatches(guess, accepted)) { setStatus("correct"); setAiEvaluation(null); registerResult(true, { productionSuccess: PRODUCTION_MODES.has(question.modeId || "") }); return; }
    if(question.modelOnly) {
      setAiBusy(true); setAiError(null);
      try {
        const evaluation = await evaluateFreeForm(question, guess);
        setAiEvaluation(evaluation);
        const genuine = evaluation.correct && evaluation.targetWordUsed && evaluation.semanticUse === "correct";
        if (genuine) {
          setStatus("correct");
          registerResult(true, { productionSuccess: PRODUCTION_MODES.has(question.modeId || ""), aiEvaluated: true });
        } else if (evaluation.semanticUse === "partly_correct" && evaluation.naturalness !== "nonsense") {
          setStatus("close");
          registerResult(false, { productionSuccess: false, aiEvaluated: true });
        } else {
          setStatus("wrong");
          registerResult(false, { aiEvaluated: true });
        }
      } catch (e) {
        setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer.");
        setStatus("aiError");
      } finally {
        setAiBusy(false);
      }
      return;
    }
    const spell = spellingDistanceInfo(guess, question.answer);
    if (spell.close) { setStatus("close"); setAiEvaluation(null); registerResult(false, { spellingIssue: true, masteryCorrect: false, productionSuccess: false }); return; }
    if (question.allowAlternativeGap) {
      setAiBusy(true); setAiError(null);
      try {
        const evaluation = await evaluateAlternativeGap(question, guess);
        setAiEvaluation(evaluation);
        if (evaluation.correct) {
          setStatus("correctAlternative");
          registerResult(false, { roundCorrect: true, masteryCorrect: false, productionSuccess: false, aiEvaluated: true });
        } else { setStatus("wrong"); registerResult(false, { aiEvaluated: true }); }
      } catch (e) { setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer."); setStatus("aiError"); }
      finally { setAiBusy(false); }
      return;
    }
    setStatus("wrong"); registerResult(false);
  }

  async function submitGrammarCorrection() {
    if (!question?.court || aiBusy || !typed.trim()) return;
    setAiBusy(true); setAiError(null);
    try {
      const result = await evaluateGrammarCorrection(question, typed.trim());
      setGrammarCorrectionResult(result);
    } catch (e) {
      console.error("Grammar correction evaluation failed:", e);
      setGrammarCorrectionResult({ correct: false, confidence: "low", feedback: "The judge is unavailable right now. Your original answer record was not changed.", suggestedCorrection: "" });
    } finally { setAiBusy(false); }
  }

  async function submitFreeForm() {
    if (status || aiBusy || !typed.trim()) return;
    setAiBusy(true); setAiError(null);
    try {
      const evaluation = await evaluateFreeForm(question, typed.trim());
      setAiEvaluation(evaluation);
      const genuine = evaluation.correct && (question.freeformKind === "idiomMeaning" || evaluation.targetWordUsed) && evaluation.semanticUse === "correct";
      if (evaluation.correct) {
        setStatus(genuine ? "correct" : "close");
        registerResult(genuine, { roundCorrect: true, masteryCorrect: genuine, productionSuccess: genuine, aiEvaluated: true });
      } else if (evaluation.semanticUse === "partly_correct" && evaluation.naturalness !== "nonsense") {
        setStatus("close"); registerResult(false, { productionSuccess: false, aiEvaluated: true });
      } else { setStatus("wrong"); registerResult(false, { productionSuccess: false, aiEvaluated: true }); }
    } catch (e) { console.error("AI evaluation failed:", e); setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer."); setStatus("aiError"); }
    finally { setAiBusy(false); }
  }

  function continueAfterAiFailure() { setStatus("skipped"); setAiError(null); }

  function finishCurrentRound() {
    const total = roundTotalRef.current, correct = roundCorrectRef.current;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;
    if (sessionType === "level" && currentLevel) {
      const previousStars = getLevelStars(currentLevel.id), earnedStars = getStarsForAccuracy(accuracy), passed = accuracy >= 70;
      const delta = learningDelta(currentLevel.items);
      setLevelStats((prev) => ({ ...prev, [currentLevel.id]: updateLevelStat(prev[currentLevel.id], accuracy, previousStars) }));
      if (passed) setLevelsCleared((prev) => prev.includes(currentLevel.id) ? prev : [...prev, currentLevel.id]);
      setJustCleared(passed && previousStars === 0);
      setLastRoundSummary({ accuracy, correct, total, earnedStars, passed, previousStars, ...delta });
      recordStudyDay(); setScreen("results"); return;
    }
    if (sessionType === "weak") {
      const reviewItems = roundQueue.map((entry) => ({ kind: "word", obj: entry.wordObj }));
      setLastRoundSummary({ accuracy, correct, total, ...learningDelta(reviewItems) }); recordStudyDay(); setScreen("reviewResults"); return;
    }
    if (sessionType === "challenge") { recordStudyDay();setToast({text:`Challenge complete: ${correct}/${total}`});setScreen("levels");return; }
    if (sessionType === "final") { setFinalRecallSummary({ accuracy, correct, total }); setScreen("finalReport"); }
  }

  function nextQuestion() {
    const isLast = roundIndex + 1 >= roundQueue.length;
    if (isLast) { finishCurrentRound(); return; }
    setRoundIndex((i) => i + 1); setSelected(null); setSelectedMulti([]); setTyped(""); setStatus(null); setAvailableTokens([]); setOrderedTokens([]); setChallengeStepIndex(0); setChallengeStepResults([]); setStepAnswer(""); setStepFeedback(null); feedbackRequestIdRef.current++; setFeedbackDetail(null); setAiEvaluation(null); setAiError(null); setGrammarCorrectionResult(null);
  }

  async function finishFinalCaseReport() {
    if (!finalCaseWords.length || !finalReportText.trim() || aiBusy) return;
    setAiBusy(true); setAiError(null);
    try {
      const evaluation = await evaluateFinalReport(finalCaseWords, finalReportText.trim());
      setFinalCaseResult(evaluation);
      if (evaluation.confidence !== "low") {
        let nextMastery = masteryRef.current;
        const now = Date.now();
        evaluation.words.forEach((result) => {
          if (!result.productionSuccess) return;
          const word = finalCaseWords.find((w) => w.word === result.word); if (!word) return;
          const prev = normalizeMasteryRecord(nextMastery[word.word]);
          const prevMode = normalizeModeStats(prev.modes.finalReport);
          let record = { ...prev, correct: prev.correct + 1, total: prev.total + 1, modes: { ...prev.modes, finalReport: { ...prevMode, correct: prevMode.correct + 1, total: prevMode.total + 1, lastResult: "correct", lastDifficulty: 4 } }, productionCorrect: prev.productionCorrect + 1, productionAttempts: prev.productionAttempts + 1, sentenceAttempts: prev.sentenceAttempts + 1, sentenceSuccesses: prev.sentenceSuccesses + 1, aiEvaluatedAttempts: prev.aiEvaluatedAttempts + 1, lastResult: "correct", recentResults: [...prev.recentResults, { correct: true, modeId: "finalReport", difficulty: 4, at: now }].slice(-RECENT_RESULT_LIMIT), ...updateReviewStreak(prev, true, now, { productionNow: true }) };
          if (getMasteryStage(record, {kind:"word",obj:word}) === MASTERY_STAGE.MASTERED) record.everMastered = true;
          nextMastery = { ...nextMastery, [word.word]: record };
        });
        masteryRef.current = nextMastery; setMastery(nextMastery);
      }
      recordStudyDay(); setScreen("finalResults");
    } catch (e) { console.error("Final Case AI failed:", e); setAiError("AI evaluation is unavailable. Retry the report, or return without changing mastery."); }
    finally { setAiBusy(false); }
  }

  // Reports the current variant as bad: retires it permanently, queues a
  // replacement in the background, and skips to the next case without
  // counting against the player.
  function handleFlag() {
    if (!question || !question.poolType || !question.poolItemId) return;
    const wordObj = question.target;
    const wordPools = getWordPools(pools, wordObj);
    const arr = wordPools[question.poolType].map((it) =>
      it.id === question.poolItemId
        ? { ...it, flagged: true, lockedUntil: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 }
        : it
    );
    const nextWordPools = { ...wordPools, [question.poolType]: arr };
    const nextPools = { ...pools, [wordObj.word]: nextWordPools };
    setPools(nextPools);
    triggerGeneration([{ word: wordObj.word, poolType: question.poolType }], nextPools);
    nextQuestion();
  }

  // --- Speed Round ---------------------------------------------------------

  const MIN_LEARNED_FOR_SPEED = 5;
  const masteredWords = masteredOnlyWords;

  function startSpeedRound() {
    if (masteredOnlyWords.length < MIN_LEARNED_FOR_SPEED) return;
    const queue = [];
    for (let i = 0; i < SPEED_QUEUE_SIZE; i++) {
      // Never the same word twice in a row.
      let raw = null;
      for (let tries = 0; tries < 6; tries++) { raw = buildSpeedQuestion(masteredOnlyWords); if (!raw || raw.answer !== queue.at(-1)?.answers[0]) break; }
      if (!raw) break;
      queue.push(speedQuestionV2(raw, i));
    }
    if (!queue.length) { setToast({ text: "No short questions with safe options are available." }); return; }
    launchSession({ kind: "speed", id: `speed-${Date.now()}`, title: "Speed Round", queue, index: 0, answers: [], introductions: [], deadline: Date.now() + SPEED_SECONDS * 1000 });
  }

  async function handleReset() {
    progressExtrasRef.current={};setActiveSession(null);setDailyProgress(null);
    try { await repo.resetProgress(); } catch (e) { console.error("Could not reset progress:", e); setStorageWarning("Progress couldn't be reset on the server. Check your connection and try again."); }
    const empty = emptyProgressData();
    setScore(0); setStreak(0); setBestStreak(0); setAttempted(0);
    setMastery({}); masteryRef.current = {};
    setLevelsCleared([]); setLevelStats({});
    setStudyStreak(0); setBestStudyStreak(0); setLastStudyDate(null); studyRef.current = { studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null };
    setPools({}); poolsRef.current = {}; setConfusions({}); confusionsRef.current = {};
    setBestSpeedScore(0); setBestSpeedCombo(0); pendingGenRef.current = new Set(); seenBadgesRef.current = new Set();
    setSolvedStories([]);setSessionLogs([]);
    setScreen("levels"); setCurrentLevelIndex(null);
    // Content is intentionally left alone here.
  }
  // Full factory reset: progress AND every imported word/grammar/pun/story/
  // combo, plus the level order they built. Distinct from handleReset, which
  // deliberately leaves imported content untouched.
  async function handleWipeEverything() {
    await handleReset();
    mergeCustomData([], [], [], [], []);
    setCustomWords([]); setCustomGrammar([]); setCustomChallenges([]);
    setCustomCombos([]); setCustomStories([]);
    setDataVersion((v) => v + 1);
    try { await repo.wipeContent(); } catch (e) { console.error("Could not clear content:", e); }
  }

  // Step 1: parse the pasted export and figure out what's genuinely new
  // (dedup against everything already loaded, built-in or imported).
  // Builds a JSON snapshot of every playable piece of content, meant to be
  // handed to another AI for a review pass, then brought back in with
  // "Apply AI Review" below.
  function handleExport(mode) {
    const content = V2.contentOnly(mode === "builtin" ? {words:BUILTIN_WORDS,grammar:BUILTIN_GRAMMAR,challenges:BUILTIN_CHALLENGES} : liveContent());
    const payload = mode === "backup" ? {
      ...progressExtrasRef.current, ...content, kind:"backup", schemaVersion:SCHEMA_VERSION, contentSchemaVersion:2,
      activeSession, levelOrder:LEVEL_ORDER, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings,
    } : content;
    setExportText(JSON.stringify(payload,null,2)); setExportCopied(false); setContentPanelView("export");
  }

  async function handleCopyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2500);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }

  function backupPayload() {
    const content = V2.contentOnly(liveContent());
    return {
      ...progressExtrasRef.current, ...content, kind: "backup", schemaVersion: SCHEMA_VERSION, contentSchemaVersion: 2,
      activeSession, levelOrder: LEVEL_ORDER, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings,
    };
  }
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(backupPayload())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `word-hunter-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function handleQuickBackup() {
    // One click, no need to open Data Center at all.
    const payload = backupPayload();
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setQuickBackupCopied(true);
      setToast({ kind: "import", text: "Full backup copied — paste it into the new version's Import Center." });
      setTimeout(() => setQuickBackupCopied(false), 2500);
    } catch (e) {
      console.error("Quick backup copy failed:", e);
      setToast({ text: "Couldn't copy to clipboard — try Admin → Data → Full Backup instead." });
    }
  }

  function handleDownloadExport() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "word-hunter-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Lets the user upload a .json/.txt file instead of pasting into the
  // Apply/Restore box — reads it as plain text and drops it straight into
  // reviewText, same path as a paste.
  function handleReviewFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setReviewError(null);
    setAiFixError(null); setAiFixChanges(null);
    const reader = new FileReader();
    reader.onload = () => {
      setReviewText(String(reader.result || ""));
    };
    reader.onerror = () => {
      setReviewError("Couldn't read that file — try pasting the JSON directly instead.");
    };
    reader.readAsText(file);
  }

  // Step 1 of applying a review: match incoming entries against what exists
  // (words by exact word text, grammar/puns by id) and split into updates
  // vs genuinely new content.
  function handleParseReview() {
    setReviewError(null);setReviewPreview(null);setAiFixError(null);
    try {
      const raw=JSON.parse(reviewText);
      const issues=V2.validateContent(raw,liveContent());
      if(issues.length){setReviewError(issues.join("\n"));return;}
      // v3 files are converted here; matching uses the converted words and
      // the existing content after renames, so a renamed word shows as an update.
      const prep=V2.prepareImport(raw,liveContent()),data=prep.data,current=prep.existing;
      const preview={backupData:raw,isBackup:raw.kind==="backup"||(!raw.kind&&(raw.mastery!==undefined||raw.pools!==undefined)),restoreProgress:false,builtinSkipped:0,invalidChallenges:[],expectedWords:WORDS.length,gotWords:data.words?.length||0,expectedChallenges:CHALLENGES.length,gotChallenges:data.challenges?.length||0,warnings:prep.warnings,renames:prep.renames,v3:raw.schemaVersion===3};
      for(const [field,singular,key] of [["words","word","word"],["grammar","grammar","id"],["challenges","challenge","id"]]){
        preview[singular+"Updates"]=[];const plural=field[0].toUpperCase()+field.slice(1);preview["new"+plural]=[];
        for(const incoming of data[field]||[]){const existing=(current[field]||[]).find(x=>V2.norm(x[key])===V2.norm(incoming[key]));if(existing)preview[singular+"Updates"].push({existing,incoming});else preview["new"+plural].push(incoming);}
      }
      setReviewPreview(preview);
    }catch(e){setReviewError("JSON: "+e.message);}
  }

  // Lets the person hand a failed import straight to the AI instead of
  // hand-editing JSON. Sends the exact validator errors plus the raw text,
  // gets back a corrected document and a plain-English list of what
  // changed, and drops the fix into the textarea — it does NOT auto-import;
  // the person still reviews and hits Parse/Preview like any other paste.
  async function handleAiFixImport() {
    if (!reviewText.trim() || !reviewError) return;
    setAiFixBusy(true); setAiFixError(null); setAiFixChanges(null);
    try {
      const result = await aiFixImportJson(reviewText, reviewError);
      setReviewText(JSON.stringify(result.fixed, null, 2));
      setAiFixChanges(result.changes.length ? result.changes : ["AI adjusted the JSON to satisfy the validator — review the fields it touched before applying."]);
      setReviewError(null);
    } catch (e) {
      setAiFixError(e.message || "AI couldn't fix this. Try editing manually.");
    } finally {
      setAiFixBusy(false);
    }
  }

  function toggleRestoreProgress() {
    setReviewPreview((prev) => (prev ? { ...prev, restoreProgress: !prev.restoreProgress } : prev));
  }

  // Step 2: apply it. Matched entries keep their word/id (the progress key)
  // and only refresh their content — including any already-seeded pool
  // variants, so an in-progress word shows the improved text too. Anything
  // unmatched goes through the normal capacity-aware level placement.
  function handleConfirmReview() {
    if(!reviewPreview)return;
    const {backupData:raw,restoreProgress}=reviewPreview;
    const issues=V2.validateContent(raw,restoreProgress?{}:liveContent());if(issues.length){setReviewError(issues.join("\n"));return;}
    const prep=V2.prepareImport(raw,restoreProgress?{}:liveContent()),data=prep.data;
    // The existing restore checkbox plus the explicit Restore backup button
    // confirm replacement inside the artifact, without a sandbox-blocked native dialog.
    const content=V2.mergeContent(prep.existing,data);
    const catMap=new Map(prep.renames.categories.map(r=>[r.from,r.to]));
    const baseOrder=[...new Set(LEVEL_ORDER.map(t=>catMap.get(t)||t))];
    const order=restoreProgress&&Array.isArray(raw.levelOrder)?raw.levelOrder:insertLevelTitles(baseOrder,[...new Set([...(prep.levelOrder||[]),...[...content.words,...content.grammar,...content.challenges].map(x=>x.category).filter(Boolean)])]);
    contentNoteRef.current=data.note||contentNoteRef.current;
    mergeCustomData(content.words,content.grammar,content.challenges,order);
    setCustomWords(content.words);setCustomGrammar(content.grammar);setCustomChallenges(content.challenges);setCustomCombos(content.combos);setCustomStories(content.stories);
    if(!restoreProgress)migrateRenamedProgress(prep.renames);
    if(restoreProgress){
      const restored=migrateProgressData(data);progressExtrasRef.current=restored;setActiveSession(restored.activeSession||null);setDailyProgress(restored.dailyProgress||null);
      setScore(restored.score);setStreak(restored.streak);setBestStreak(restored.bestStreak);setAttempted(restored.attempted);
      setMastery(restored.mastery);masteryRef.current=restored.mastery;setLevelsCleared(restored.levelsCleared);setLevelStats(restored.levelStats);
      setStudyStreak(restored.studyStreak);setBestStudyStreak(restored.bestStudyStreak);setLastStudyDate(restored.lastStudyDate);
      studyRef.current={studyStreak:restored.studyStreak,bestStudyStreak:restored.bestStudyStreak,lastStudyDate:restored.lastStudyDate};
      setPools(restored.pools);poolsRef.current=restored.pools;setBestSpeedScore(restored.bestSpeedScore);setBestSpeedCombo(restored.bestSpeedCombo);setConfusions(restored.confusions);confusionsRef.current=restored.confusions;setSolvedStories(restored.solvedStories||[]);setSessionLogs(restored.sessionLogs||[]);setQuestionReports(Array.isArray(restored.reports)?restored.reports:[]);setSettings(normalizeSettings(restored.settings));
    }
    // Content import deliberately retains pools and all progress byte-for-byte.
    // New sessions read current authored text, not stale seed variants.
    setDataVersion(v=>v+1);setReviewPreview(null);setReviewText("");setScreen("levels");
    setToast({text:restoreProgress?"Full backup restored":"Content merged; all player progress retained"});
  }


  const earnedBadgesCount = BADGES.filter((b) => getBadgeProgress(b, { mastery, bestStreak }).earned).length;
  const totalLevelsCleared = levelsCleared.length;
  const nextLevelIndex = currentLevelIndex !== null ? currentLevelIndex + 1 : null;
  const hasNextLevel = nextLevelIndex !== null && nextLevelIndex < LEVELS.length;
  const roundAccuracy = roundTotal > 0 ? Math.round((roundCorrect / roundTotal) * 100) : 0;
  const finalEvidenceUsed = finalCaseWords.filter((word) => { const n = normalizeAnswerText(finalReportText); return n.includes(normalizeAnswerText(word.word)); }).length;
  const fileMeta = currentEntry ? entryFileMeta(currentEntry) : null;
  const FileIcon = fileMeta ? fileMeta.icon : Search;

  const masteredWordCount = Object.entries(mastery).filter(([key, stats]) => isWordKey(key) && V2.stage(stats) === "Mastered").length;
  const showNav = !["session", "playing", "finalReport", "speed", "admin"].includes(screen);

  // Addresses that can't be shown go home (replacing, so Back still works):
  // unknown paths, admin pages for players, and /play with nothing to play.
  useEffect(() => {
    if (!loaded) return;
    const nothingToPlay = route.screen === "play" && playScreen === "session" && (!activeSession || activeSession.completed);
    if (route.screen === "notFound" || (route.screen === "admin" && !isAdmin) || nothingToPlay) navigate("/", { replace: true });
  }, [loaded, route, playScreen, activeSession, isAdmin]);

  if (loadError) return (
    <main className="splash" role="alert">
      <div className="splash-inner">
        <h1 className="auth-title">Word <span>Hunter</span></h1>
        <p className="load-error">Couldn't load your game ({loadError}). Your saved progress is safe — nothing was changed.</p>
        <button className="auth-submit" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </main>
  );
  if (!loaded) return <Splash />;

  return (
    <div className={`wh-root${showNav ? " has-nav" : ""}${screen === "admin" ? " screen-admin" : ""}`}>

      <div className={`wh-container${screen === "admin" ? " wh-container-admin" : ""}`}>
        {toast && (
          <div className="wh-toast" role="status">
            {!toast.kind && <b>{toast.text}</b>}
            {toast.kind === "badge" && <><Trophy size={15} /> New badge: <b>{toast.text}</b></>}
            {toast.kind === "import" && <><Upload size={15} /> <b>{toast.text}</b></>}
            {toast.kind === "merge" && <><CheckCircle2 size={15} /> <b>{toast.text}</b></>}
          </div>
        )}

        {storageWarning && <div className="wh-panel wh-storage-warning" role="status"><span>{storageWarning}</span><button className="wh-warning-close" aria-label="Dismiss" onClick={()=>setStorageWarning(null)}><X size={14} /></button></div>}
        <header className="wh-header ui-header">
          <div className="ui-header-top">
            <div>
              <h1 className="wh-title">WORD <span>HUNTER</span></h1>
              <div className="wh-sub">{profile?.username && profile.id !== "local" ? `Hi ${profile.username} · ` : ""}{totalLevelsCleared}/{LEVELS.length} levels cleared</div>
            </div>
            <SyncStatus repo={repo} />
          </div>
          <div className="wh-stats ui-stat-row">
            <span className="ui-stat" title="Score"><b>{score}</b> pts</span>
            <span className="ui-stat wh-stat-streak" title="Answer streak"><Flame size={14} /> {streak}</span>
            <span className="ui-stat" title="Study streak (days in a row)"><b>{studyStreak}</b>d streak</span>
            <button className="wh-icon-btn ui-stat" onClick={() => setScreen(badgesOpen ? "levels" : "badges")} aria-pressed={badgesOpen} title="View badges">
              <Trophy size={13} /> {earnedBadgesCount}/{BADGES.length}
            </button>
            <button className="wh-icon-btn ui-stat" onClick={() => setScreen(dashboardOpen ? "levels" : "stats")} aria-pressed={dashboardOpen} title="View stats dashboard">
              <BarChart3 size={13} /> Stats
            </button>
          </div>
          <div className="wh-ask-bar">
            <input value={askAiTerm} onChange={event=>setAskAiTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();openAskAi(askAiTerm);}}} placeholder="Look up a word…" aria-label="Ask AI about a word" enterKeyHint="search" />
            <button className="wh-icon-btn" onClick={()=>openAskAi(askAiTerm)} title="Ask AI"><HelpCircle size={15}/><span className="ui-hide-narrow"> Ask AI</span></button>
            <button className="wh-icon-btn" onClick={()=>{const term=askAiTerm.trim();if(term)setListenTerm(term);}} title="Hear it pronounced" aria-label="Listen"><Volume2 size={15}/></button>
          </div>
        </header>
        {listenTerm&&<PronunciationModal term={listenTerm} onClose={()=>setListenTerm(null)}/>}
        {askAiOpen&&<div className="wh-ai-drawer" role="dialog" aria-modal="true" aria-label="Ask AI about a word" onMouseDown={event=>{if(event.target===event.currentTarget)setAskAiOpen(false);}}>
          <aside className="wh-ai-drawer-card">
            <div className="wh-ai-drawer-head"><div><div className="wh-ai-meta">WORD HUNTER FIELD GUIDE</div><h2>Ask AI</h2></div><button className="wh-icon-btn" onClick={()=>setAskAiOpen(false)} aria-label="Close"><X size={18}/></button></div>
            <div className="wh-type-form"><input autoFocus value={askAiTerm} onChange={event=>setAskAiTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();runAskAi();}}} placeholder="Type a word or short phrase…"/><button className="wh-level-btn" disabled={askAiBusy||!askAiTerm.trim()} onClick={()=>runAskAi()}>{askAiBusy?'Investigating…':'Explain'}</button></div>
            <p className="wh-ai-meta">Tip: select a word inside any question or story to open this panel automatically.</p>
            {askAiError&&<div className="wh-import-error">{askAiError}</div>}
            {askAiResult&&<article className="wh-ai-card">
              <h2>{askAiResult.word}</h2><div className="wh-ai-meta">{askAiResult.partsOfSpeech?.length>0&&<b>{askAiResult.partsOfSpeech.join(" / ")}</b>}{askAiResult.partsOfSpeech?.length>0&&' · '}{askAiResult.type} · {askAiResult.category} · {askAiResult.pronunciation}</div>
              <p><b>Meaning:</b> {askAiResult.meaning}</p><p><b>Example:</b> {askAiResult.situation}</p>
              {!!askAiResult.nearWords?.length&&<><b>Close words:</b>{askAiResult.nearWords.map(item=><p key={item.word}><b>{item.word}:</b> {item.difference}</p>)}</>}
              {askAiResult.commonMistake&&<p><b>Common mistake:</b> {askAiResult.commonMistake.sentence}<br/><b>Better:</b> {askAiResult.commonMistake.correction}<br/>{askAiResult.commonMistake.why}</p>}
              <div className="wh-ai-actions"><button className="wh-back-btn" onClick={()=>setListenTerm(askAiResult.word)}><Volume2 size={13}/> Listen</button>{askAiResult.alreadyInCollection?<span className="wh-results-unlock">Already in your collection</span>:isAdmin?<button className="wh-level-btn" onClick={()=>addAiWord()}>Add to Collection</button>:null}</div>
            </article>}
          </aside>
        </div>}
        {screen==="admin"&&isAdmin&&<Suspense fallback={<ScreenSkeleton />}><AdminPanel route={route} profile={profile} score={score} studyStreak={studyStreak} bestStudyStreak={bestStudyStreak} content={{...liveContent(),levels:LEVEL_ORDER.map(title=>({id:`cat-${title}`,title}))}} mastery={mastery} confusions={confusions} reports={questionReports} activeSession={activeSession} sessionLogs={sessionLogs} estimatedStorageBytes={JSON.stringify({...progressExtrasRef.current,activeSession,score,streak,bestStreak,attempted,mastery,levelsCleared,levelStats,studyStreak,bestStudyStreak,lastStudyDate,pools,bestSpeedScore,bestSpeedCombo,confusions}).length} settings={settings} onUpdateSettings={setSettings} onClearActiveSession={()=>setActiveSession(null)} onUpdate={updateAdminContent} onResolveReport={resolveQuestionReport} onReviewReport={reviewQuestionReport} onRetireVariant={retireReportedVariant} onDeleteReport={deleteQuestionReport} onMergeCategories={mergeCategories} onRemoveEmptyLevels={removeEmptyLevels} onResetProgress={()=>setConfirmAction("reset")} onWipeEverything={()=>setConfirmAction("wipe")} onClose={()=>setScreen("levels")} onOpenImport={()=>{setContentPanelView("review");setScreen("data");}} onExport={mode=>{handleExport(mode);setContentPanelView("export");setScreen("data");}}/></Suspense>}
        {confirmAction && (
          <div className="wh-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmAction(null); }}>
          <div className="wh-panel wh-confirm-panel" role="alertdialog">
            <p>
              {confirmAction === "reset"
                ? "Reset all progress? This clears your score, streaks, mastery, and level stats. Your imported words and content stay untouched."
                : "Clear everything? This deletes your progress AND all imported words, grammar, and stories. This cannot be undone — make sure you have a Full Backup first."}
            </p>
            <div className="wh-regen-actions">
              <button
                className="wh-level-btn"
                onClick={async () => { if (confirmAction === "reset") await handleReset(); else await handleWipeEverything(); setConfirmAction(null); }}
              >
                {confirmAction === "reset" ? "Yes, reset progress" : "Yes, delete everything"}
              </button>
              <button className="wh-back-btn wh-nav-btn" onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
          </div>
        )}
        {deleteCategoryTarget && (
          <div className="wh-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteCategoryTarget(null); }}>
          <div className="wh-panel wh-confirm-panel" role="alertdialog">
            <p>
              Delete the category "{deleteCategoryTarget.title}"? This removes its words, grammar, combos, stories, and challenges from your content. This cannot be undone — make sure you have a Full Backup first.
            </p>
            <div className="wh-regen-actions">
              <button
                className="wh-level-btn wh-danger-btn"
                onClick={() => { deleteLevelCategory(deleteCategoryTarget); setDeleteCategoryTarget(null); }}
              >
                Yes, delete category
              </button>
              <button className="wh-back-btn wh-nav-btn" onClick={() => setDeleteCategoryTarget(null)}>Cancel</button>
            </div>
          </div>
          </div>
        )}

        {badgesOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Case Archive — Badges</span>
              <button onClick={() => setScreen("levels")} aria-label="Close badges panel">
                <X size={15} />
              </button>
            </div>
            <div className="wh-badges-grid">
              {BADGES.map((b) => {
                const { done, total, earned } = getBadgeProgress(b, { mastery, bestStreak });
                return (
                  <div key={b.id} className={`wh-badge ${earned ? "earned" : ""}`}>
                    {earned ? <Award size={16} /> : <Lock size={14} />}
                    <div className="wh-badge-text">
                      <div className="wh-badge-label">{b.label}</div>
                      <div className="wh-badge-progress">{done}/{total}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {dashboardOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Study Dashboard</span>
              <button onClick={() => setScreen("levels")} aria-label="Close dashboard">
                <X size={15} />
              </button>
            </div>
            <div className="wh-dash-summary">
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.total}</div>
                <div className="wh-dash-stat-label">Total words</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.practiced}</div>
                <div className="wh-dash-stat-label">Practiced</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.total - overviewStats.practiced}</div>
                <div className="wh-dash-stat-label">Not tried yet</div>
              </div>
              <div className="wh-dash-stat mastered">
                <div className="wh-dash-stat-num">{stageSummary.Mastered}</div>
                <div className="wh-dash-stat-label">Mastered</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{stageSummary.Learned}</div>
                <div className="wh-dash-stat-label">Learned</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{stageSummary.Familiar}</div>
                <div className="wh-dash-stat-label">Familiar</div>
              </div>
            </div>
            <div className="wh-dash-bar" aria-hidden="true">
              {overviewStats.total > 0 && (
                <>
                  <span className="wh-dash-bar-seg mastered" style={{ width: `${(stageSummary.Mastered / overviewStats.total) * 100}%` }} />
                  <span className="wh-dash-bar-seg learned" style={{ width: `${(stageSummary.Learned / overviewStats.total) * 100}%` }} />
                  <span className="wh-dash-bar-seg familiar" style={{ width: `${(stageSummary.Familiar / overviewStats.total) * 100}%` }} />
                </>
              )}
            </div>
            {overviewStats.accuracy !== null && (
              <div className="wh-dash-accuracy">Overall accuracy: {overviewStats.accuracy}%</div>
            )}
            <div className="wh-dash-scroll">
              {LEVELS.map((level) => (
                <div className="wh-dash-group" key={level.id}>
                  <div className="wh-dash-group-title">{level.title}</div>
                  <table className="wh-dash-table">
                    <tbody>
                      {level.items.map((item) => {
                        const key = levelItemKey(item);
                        const name =
                          item.kind === "word"
                            ? item.obj.word
                            : item.kind === "grammar"
                            ? `${item.obj.rule} #${item.obj.id.slice(1)}`
                            : item.obj.word;
                        const stats = mastery[key];
                        const attempts = stats?.total || 0;
                        const correct = stats?.correct || 0;
                        const acc = attempts > 0 ? Math.round((correct / attempts) * 100) : null;
                        return (
                          <tr key={key}>
                            <td className="wh-dash-name">{name}</td>
                            <td className="wh-dash-num">{attempts === 0 ? "not tried" : `${correct}/${attempts} correct`}</td>
                            <td className="wh-dash-num">{acc === null ? "—" : `${acc}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {importOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Data Center</span>
              <button
                onClick={() => { setScreen("levels"); setReviewPreview(null); setReviewError(null); setAiFixError(null); setAiFixChanges(null); }}
                aria-label="Close content panel"
              >
                <X size={15} />
              </button>
            </div>

            <div className="wh-content-tabs">
              <button className={contentPanelView === "export" ? "active" : ""} onClick={() => setContentPanelView("export")}>Export</button>
              <button className={contentPanelView === "review" ? "active" : ""} onClick={() => setContentPanelView("review")}>Apply / Restore</button>
            </div>

            {contentPanelView === "export" && (
              <>
                <p className="wh-import-hint">
                  <b>Content only</b> — for handing to another AI to review wording/clarity. Keep every "word"
                  and "id" field unchanged so your progress stays attached, then paste its answer into "Apply / Restore". Challenge IDs are stable progress keys too.<br />
                  <b>Full backup</b> — everything, including your score, streak, and mastery. Use this to move
                  to a new browser/tab, or as a safety copy.
                </p>
                <div className="wh-import-actions wh-import-actions-tight">
                  <button className="wh-import-btn secondary" onClick={() => handleExport("content")}>Content only</button>
                  <button className="wh-import-btn secondary" onClick={() => handleExport("backup")}>Full backup</button>
                </div>
                {exportText && (
                  <>
                    <textarea className="wh-import-textarea" value={exportText} readOnly rows={8} onFocus={(e) => e.target.select()} />
                    <div className="wh-import-actions">
                      <button className="wh-import-btn secondary" onClick={handleDownloadExport}>
                        <Download size={13} /> Download .json
                      </button>
                      <button className="wh-import-btn primary" onClick={handleCopyExport}>
                        {exportCopied ? <><ClipboardCheck size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {contentPanelView === "review" && !reviewPreview && (
              <>
                <p className="wh-import-hint">
                  Paste the reviewed JSON back here, or upload a .json/.txt file. Matched words/rules/challenges get
                  their content refreshed without touching your progress; anything new gets added as usual.
                </p>
                <textarea
                  className="wh-import-textarea"
                  value={reviewText}
                  onChange={(e) => { setReviewText(e.target.value); setAiFixError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (reviewText.trim()) handleParseReview(); } }}
                  placeholder="Paste the reviewed JSON here…"
                  rows={8}
                />
                {reviewError && <div className="wh-import-error">{reviewError}<div className="wh-import-actions"><button className="wh-import-btn primary" disabled={aiFixBusy} onClick={handleAiFixImport}>{aiFixBusy ? "Asking AI…" : <><Sparkles size={13} /> Fix with AI</>}</button></div></div>}
                {aiFixError && <div className="wh-import-error">{aiFixError}</div>}
                {aiFixChanges && <div className="wh-import-hint"><b>AI adjusted the JSON below to fix the errors — review it, then Parse again:</b><ul>{aiFixChanges.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                <div className="wh-import-actions">
                  <input
                    ref={reviewFileInputRef}
                    id="wh-review-file-input"
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
                    onChange={handleReviewFileChange}
                  />
                  <label htmlFor="wh-review-file-input" className="wh-import-btn secondary">
                    <Upload size={13} /> Upload file
                  </label>
                  <button className="wh-import-btn primary" onClick={handleParseReview} disabled={!reviewText.trim()}>
                    Parse
                  </button>
                </div>
              </>
            )}

            {contentPanelView === "review" && reviewPreview && (
              <>
                <div className="wh-import-summary">
                  <div>
                    <b>{reviewPreview.wordUpdates.length + reviewPreview.grammarUpdates.length + reviewPreview.challengeUpdates.length}</b> updated,{" "}
                    <b>{reviewPreview.newWords.length + reviewPreview.newGrammar.length + reviewPreview.newChallenges.length}</b> new · {reviewPreview.backupData.combos?.length||0} combos · {reviewPreview.backupData.stories?.length||0} stories
                    {reviewPreview.builtinSkipped > 0 && <> — {reviewPreview.builtinSkipped} matched built-in content and can't be edited this way</>}
                  </div>
                  <div className="wh-import-breakdown">
                    {reviewPreview.wordUpdates.length > 0 && <span>{reviewPreview.wordUpdates.length} word(s) updated</span>}
                    {reviewPreview.grammarUpdates.length > 0 && <span>{reviewPreview.grammarUpdates.length} grammar updated</span>}
                    {reviewPreview.challengeUpdates.length > 0 && <span>{reviewPreview.challengeUpdates.length} challenge(s) updated by stable ID</span>}
                    {reviewPreview.newWords.length > 0 && <span>{reviewPreview.newWords.length} new word(s)</span>}
                    {reviewPreview.newGrammar.length > 0 && <span>{reviewPreview.newGrammar.length} new grammar</span>}
                    {reviewPreview.newChallenges.length > 0 && <span>{reviewPreview.newChallenges.length} new challenge(s)</span>}
                    {reviewPreview.invalidChallenges.length > 0 && <span>{reviewPreview.invalidChallenges.length} invalid challenge(s) skipped</span>}
                    <span>received {reviewPreview.gotWords} of {reviewPreview.expectedWords} current words</span>
                    <span>received {reviewPreview.gotChallenges} challenge(s); currently loaded {reviewPreview.expectedChallenges}</span>
                  </div>
                  <p>Partial content files are merged. Missing arrays do not delete current items. Structural checks do not verify B1 language or semantic accuracy.</p>
                  {reviewPreview.renames && (reviewPreview.renames.words.length > 0 || reviewPreview.renames.categories.length > 0) && <div className="wh-import-hint"><b>Renamed by id — progress moves with them:</b><ul>{[...reviewPreview.renames.words, ...reviewPreview.renames.categories].map((r, i) => <li key={i}>{r.from} → {r.to}</li>)}</ul></div>}
                  {reviewPreview.warnings?.length > 0 && <div className="wh-import-error"><b>{reviewPreview.warnings.length} warning(s) — the rest imports normally:</b><ul>{reviewPreview.warnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}</ul>{reviewPreview.warnings.length > 30 && <p>…and {reviewPreview.warnings.length - 30} more.</p>}</div>}
                </div>
                {reviewPreview.isBackup && (
                  <label className="wh-restore-toggle">
                    <input type="checkbox" checked={reviewPreview.restoreProgress} onChange={toggleRestoreProgress} />
                    Also restore progress (score, streak, mastery, cleared levels) — this overrides what's currently loaded
                  </label>
                )}
                <div className="wh-import-actions">
                  <button className="wh-import-btn secondary" onClick={() => setReviewPreview(null)}>Back</button>
                  <button className="wh-import-btn primary" onClick={handleConfirmReview}>
                    {reviewPreview.restoreProgress ? "Restore backup" : "Apply review"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {screen === "levels" && <>
          {showFreshCopyPrompt && <div className="wh-fresh-copy-banner">
            <p><b>Fresh copy detected.</b> No saved progress or content found here — if you have a backup from a previous version, restore it now before you start playing.</p>
            <div className="wh-regen-actions">
              <button className="wh-level-btn" onClick={()=>{setContentPanelView("review");setShowFreshCopyPrompt(false);setScreen("data");}}>Open Import Center</button>
              <button className="wh-back-btn wh-nav-btn" onClick={()=>setShowFreshCopyPrompt(false)}>Dismiss</button>
            </div>
          </div>}
          <nav className="wh-v2-nav" aria-label="Game sections">{[["practice","Practice"],["stories","Stories"],["challenges","Challenges"]].map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}</nav>
          {activeSession&&!activeSession.completed&&<button className="wh-level-btn" onClick={()=>setScreen("session")}>Resume {activeSession.title} ({Math.min(activeSession.index+1,activeSession.queue.length)}/{activeSession.queue.length})</button>}
          {section==="practice"&&(()=>{const day=todayProgress(dailyProgress);const goal=settings.dailyGoal;const done=day.answered>=goal;return <div className={`wh-daily-goal ${done?"done":""}`}><div className="wh-daily-goal-head"><b>{done?<><CheckCircle2 size={15}/> Daily goal reached</>:<><Target size={15}/> Today's goal</>}</b><span>{day.answered} / {goal} questions{day.answered?` · ${Math.round(day.correct/day.answered*100)}% correct`:""}</span></div><div className="wh-daily-goal-bar"><span style={{width:`${Math.min(100,day.answered/goal*100)}%`}}/></div>{done&&day.answered>goal&&<small>+{day.answered-goal} bonus questions today</small>}</div>;})()}
          {section==="stories"&&<div className="wh-panel"><h2>Stories</h2>
            {isAdmin&&<div className="wh-story-builder"><h3>Generate a mixed-category story</h3><p className="wh-regen-meta">Choose one or more categories. Weak words are selected first and distributed across your choices.</p><div className="wh-category-multiselect">{LEVEL_ORDER.filter(category=>WORDS.some(word=>word.category===category)).map(category=><label key={category} className={`wh-category-choice ${selectedStoryCategories.includes(category)?"selected":""}`}><input type="checkbox" checked={selectedStoryCategories.includes(category)} onChange={()=>toggleStoryCategory(category)}/><span>{category}</span><small>{WORDS.filter(word=>word.category===category).length}</small></label>)}</div>{storyGenState!=="loading"&&<button className="wh-level-btn" disabled={!selectedStoryCategories.length} onClick={handleGenerateStory}>✨ Generate from {selectedStoryCategories.length||0} categor{selectedStoryCategories.length===1?"y":"ies"}</button>}{storyGenError&&storyGenState!=="loading"&&<p className="wh-regen-status error">{storyGenError}</p>}</div>}
            {storyGenState==="loading"&&<p className="wh-regen-status">Writing and checking a new story…</p>}
            {storyGenState&&typeof storyGenState==="object"&&<div className="wh-regen-preview">
              <p className="wh-regen-label">New story — preview</p>
              <p><strong>{storyGenState.title}</strong></p>
              <p>{storyGenState.text}</p>
              <p className="wh-regen-meta">Categories: {(storyGenState.sourceCategories||[]).join(" + ")} · Hidden targets: {storyGenState.targetWords.join(", ")} · {storyGenState.questions.length} questions{storyGenState.grammarQuestions?.length?` + ${storyGenState.grammarQuestions.length} grammar`:""}</p>
              <div className="wh-regen-actions">
                <button className="wh-level-btn" onClick={()=>{setCustomStories(prev=>[...prev,storyGenState]);setStoryGenState(null);}}>Add to My Stories</button>
                <button className="wh-back-btn wh-nav-btn" onClick={handleGenerateStory}>Regenerate</button>
                <button className="wh-back-btn wh-nav-btn" onClick={()=>setStoryGenState(null)}>Discard</button>
              </div>
            </div>}
            {!customStories.length&&<p>No authored stories loaded. Import a Content v2 file to add them.</p>}{[...customStories].sort((a,b)=>a.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length-b.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length).map(story=>{const fresh=story.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length;const record=solvedStories.find(e=>e.id===story.id);return <article className="wh-v2-learn" key={story.id}><strong>{story.title}{record&&<span className="wh-story-solved-flag"><CheckCircle2 size={13}/> Solved · {record.correct}/{record.total}</span>}</strong><p>{story.questions.length}{story.grammarQuestions?.length?` + ${story.grammarQuestions.length} grammar`:""} questions · {fresh?`${fresh} new words: preview first`:"Ready for review"}</p><button className="wh-level-btn" onClick={()=>launchStory(story)}>{record?"Play again":"Open story"}</button></article>;})}</div>}
          {section==="challenges"&&<div className="wh-panel"><h2>Opposite Chain</h2>{[...new Set(WORDS.filter(w=>w.chainGroup&&w.opposite).map(w=>w.chainGroup))].map(group=><button key={group} className="wh-level-btn" onClick={()=>launchChain(group)}>{group}</button>)}<h2>Authored Challenges</h2>{!CHALLENGES.length&&<p>No authored challenges loaded.</p>}{CHALLENGES.map(c=><button key={c.id} className="wh-level-btn" onClick={()=>launchAuthoredChallenge(c)}>{c.label||c.id}</button>)}</div>}
        </>}
        {screen === "session" && <SessionView session={activeSession} onChange={setActiveSession} onFinish={completeSession} onBack={()=>setScreen("levels")} words={WORDS} onIntroduce={introduceWords} onReport={reportSessionQuestion} onReviewReport={reviewQuestionReport} onWithdrawReport={deleteQuestionReport} onUpdateWord={isAdmin?updateWordFields:undefined} sound={settings.sound} onToggleSound={()=>setSettings(prev=>({...prev,sound:!prev.sound}))} onResult={recordSessionResult} onAskWord={openAskAi}/>}


        {screen === "levels" && (section === "challenges" || section === "practice") && (
          <div className={`wh-speed-card ${masteredWords.length < MIN_LEARNED_FOR_SPEED ? "locked" : ""}`}>
            <div className="wh-speed-card-icon"><Zap size={22} /></div>
            <div className="wh-speed-card-info">
              <div className="wh-speed-card-title">Speed Round</div>
              <div className="wh-speed-card-meta">
                {masteredWords.length < MIN_LEARNED_FOR_SPEED
                  ? `Master ${MIN_LEARNED_FOR_SPEED - masteredWords.length} more word${MIN_LEARNED_FOR_SPEED - masteredWords.length === 1 ? "" : "s"} to unlock`
                  : `${masteredWords.length} mastered words in the pool · best ${bestSpeedScore} pts, x${bestSpeedCombo} combo`}
              </div>
            </div>
            <button
              className="wh-speed-card-btn"
              disabled={masteredWords.length < MIN_LEARNED_FOR_SPEED}
              onClick={startSpeedRound}
            >
              <Play size={13} /> Play
            </button>
          </div>
        )}

        {screen === "levels" && (section === "challenges" || section === "practice") && (
          <div className="wh-speed-card wh-live-card">
            <div className="wh-speed-card-icon"><Users size={22} /></div>
            <div className="wh-speed-card-info">
              <div className="wh-speed-card-title">Live Challenge</div>
              <div className="wh-speed-card-meta">Play the same questions with a friend, each on your own device</div>
            </div>
            <button className="wh-speed-card-btn" onClick={() => setScreen("live")}><Play size={13} /> Play</button>
          </div>
        )}

        {screen === "levels" && section === "practice" && LEVELS.length > 0 && (
          <div className="wh-level-view-toggle" role="group" aria-label="Show levels">
            {[["lesson", "By lesson"], ["group", "By unit"]].map(([id, label]) => (
              <button key={id} className={settings.levelView === id ? "active" : ""} aria-pressed={settings.levelView === id} onClick={() => setSettings((prev) => ({ ...prev, levelView: id }))}>{label}</button>
            ))}
          </div>
        )}

        {/* By unit: each lesson's course units as their own cards. */}
        {screen === "levels" && section === "practice" && settings.levelView === "group" && (
          <div className="wh-levels-list">
            {LEVELS.map((level, i) => {
              const unlocked = isLevelUnlocked(i);
              const LevelIcon = TOPIC_ICONS[level.title] || BookOpen;
              const groups = levelGroups(level);
              if (!groups.length) return null;
              return (
                <div key={level.id} className="wh-level-group-block">
                  <h3 className="wh-level-group-heading">{level.title} <small>{groups.filter((g) => g.id).length} units</small></h3>
                  {groups.map((g) => {
                    const counts = levelStageBreakdown(g, mastery);
                    return (
                      <div key={g.id || "other"} className={`wh-level-card ${unlocked ? "" : "locked"}`}>
                        <div className="wh-level-icon"><LevelIcon size={20} /></div>
                        <div className="wh-level-info">
                          <div className="wh-level-title">{g.title}</div>
                          <div className="wh-level-meta">{g.items.length} word{g.items.length === 1 ? "" : "s"}</div>
                          <div className="wh-level-stage-bar" aria-hidden="true">
                            <span className="wh-level-stage-seg mastered" style={{ width: `${(counts.Mastered / g.items.length) * 100}%` }} />
                            <span className="wh-level-stage-seg learned" style={{ width: `${(counts.Learned / g.items.length) * 100}%` }} />
                            <span className="wh-level-stage-seg familiar" style={{ width: `${(counts.Familiar / g.items.length) * 100}%` }} />
                          </div>
                          <div className="wh-level-meta wh-level-stage-detail">
                            {counts.Mastered} mastered · {counts.Learned} learned · {counts.Familiar} familiar · {counts.New} new
                          </div>
                        </div>
                        <button className="wh-level-btn" disabled={!unlocked} onClick={() => startLevel(i, g)}>
                          {unlocked ? <Play size={13} /> : <Lock size={13} />} {unlocked ? "Practice" : "Locked"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {screen === "levels" && section === "practice" && settings.levelView !== "group" && (
          <div className="wh-levels-list">
            {LEVELS.map((level, i) => {
              const unlocked = isLevelUnlocked(i);
              const cleared = clearedSet.has(level.id);
              const stageCounts = levelStageBreakdown(level, mastery);
              const LevelIcon = TOPIC_ICONS[level.title] || BookOpen;
              return (
                <div key={level.id} className={`wh-level-card ${unlocked ? "" : "locked"}`}>
                  {isAdmin && <button
                    className="wh-level-delete-btn"
                    title="Delete category"
                    onClick={(e) => { e.stopPropagation(); setDeleteCategoryTarget(level); }}
                  >
                    <Trash2 size={14} />
                  </button>}
                  <div className="wh-level-num">{String(i + 1).padStart(2, "0")}</div>
                  <div className="wh-level-icon"><LevelIcon size={20} /></div>
                  <div className="wh-level-info">
                    <div className="wh-level-title">
                      {level.title}
                      {cleared && <CheckCircle2 size={14} color="var(--green, #4f7942)" />}
                    </div>
                    <div className="wh-level-meta">
                      {level.items.length} words · {formatStars(getLevelStars(level.id))}
                    </div>
                    <div className="wh-level-stage-bar" aria-hidden="true">
                      {level.items.length > 0 && (
                        <>
                          <span className="wh-level-stage-seg mastered" style={{ width: `${(stageCounts.Mastered / level.items.length) * 100}%` }} />
                          <span className="wh-level-stage-seg learned" style={{ width: `${(stageCounts.Learned / level.items.length) * 100}%` }} />
                          <span className="wh-level-stage-seg familiar" style={{ width: `${(stageCounts.Familiar / level.items.length) * 100}%` }} />
                        </>
                      )}
                    </div>
                    <div className="wh-level-meta wh-level-stage-detail">
                      {stageCounts.Mastered} mastered · {stageCounts.Learned} learned · {stageCounts.Familiar} familiar · {stageCounts.New} new
                    </div>
                  </div>
                  <button
                    className="wh-level-btn"
                    disabled={!unlocked}
                    onClick={() => startLevel(i)}
                  >
                    {unlocked ? <Play size={13} /> : <Lock size={13} />}
                    {cleared ? "Practice again" : unlocked ? "Practice" : "Locked"}
                  </button>
                  <button className="wh-back-btn" disabled={getLevelStars(level.id)<1} title="Available after earning one star in Practice" onClick={()=>startFinalCase(i)}>Final Case</button>
                </div>
              );
            })}
          </div>
        )}

        {screen === "playing" && question && (
          <>
            <div className="wh-round-top">
              <button className="wh-back-btn wh-nav-btn" onClick={backToLevels}>
                <ArrowLeft size={14} /> Levels
              </button>
              <div className="wh-round-progress">
                Case {roundIndex + 1}/{roundQueue.length} — {sessionType === "weak" ? "Weak Evidence" : sessionType === "final" ? "Final Case" : currentLevel?.title || "Investigation"}
              </div>
            </div>

            <div className="wh-card">
              {status && (
                <div className={`wh-stamp ${status}`}>
                  {status === "correct" ? "EVIDENCE SECURED" : status === "correctAlternative" ? "VALID ALTERNATIVE" : status === "close" ? "ALMOST" : status === "aiError" ? "CHECK PAUSED" : status === "skipped" ? "SKIPPED" : "WRONG LEAD"}
                </div>
              )}

              <div className="wh-file-row">
                <div className="wh-file-label"><FileIcon size={13} /> {fileMeta.label}</div>
                <div className="wh-file-row-right">
                  <div className="wh-category-badge">{question.target.category}</div>
                  {question.poolType && (
                    <button className="wh-flag-btn" onClick={handleFlag} title="Report this question — swap it for a new one">
                      <Flag size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="wh-sentence">{question.prompt}</div>
              {question.hint && !status && <div className="wh-hint">Hint: {question.hint}</div>}

              {question.type === "unavailable" && <button className="wh-level-btn" onClick={()=>{setStatus("skipped");}}>Skip invalid question</button>}
              {question.type === "mcq" && (
                <div className="wh-options">
                  {question.options.map((opt) => {
                    let cls = "wh-option";
                    if (status && opt === question.answer) cls += " reveal";
                    if (status && opt === selected && opt !== question.answer) cls += " wrong";
                    return (
                      <button key={opt} className={cls} disabled={!!status} onClick={() => handleSelect(opt)}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "typing" && (
                <div className="wh-type-form">
                  <input
                    className="wh-type-input"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitTyped();
                      }
                    }}
                    placeholder="Type the word…"
                    disabled={!!status || aiBusy}
                    autoFocus
                  />
                  <button
                    className="wh-type-submit"
                    type="button"
                    onClick={submitTyped}
                    disabled={!!status || aiBusy || !typed.trim()}
                  >
                    {aiBusy ? "Checking…" : "Submit"}
                  </button>
                </div>
              )}

              {question.type === "freeform" && (
                <div className="wh-type-form" style={{ display: "grid" }}>
                  <textarea
                    className="wh-freeform"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (typed.trim() && !status && !aiBusy) submitFreeForm(); } }}
                    placeholder={question.freeformKind === "sentence" ? `Write a natural sentence using ${question.target.word}…` : "Write your answer…"}
                    disabled={!!status || aiBusy}
                    autoFocus
                  />
                  <button className="wh-type-submit" type="button" onClick={submitFreeForm} disabled={!!status || aiBusy || !typed.trim()}>
                    {aiBusy ? "Examining evidence…" : "Submit Evidence"}
                  </button>
                </div>
              )}

              {question.type === "selfCheck" && (
                <div className="wh-type-form" style={{ display: "grid" }}>
                  <textarea
                    className="wh-freeform"
                    value={typed}
                    onChange={(e) => { setTyped(e.target.value); setStepFeedback(null); }}
                    placeholder={`Use: ${(question.requiredWords || []).join(" + ")}`}
                    disabled={!!status}
                    autoFocus
                  />
                  <button className="wh-type-submit" type="button" onClick={submitSelfCheck} disabled={!!status || !typed.trim()}>
                    Check Requirements
                  </button>
                  {stepFeedback && (
                    <div className={`wh-step-feedback ${stepFeedback.correct ? "" : "wrong"}`}>
                      {stepFeedback.explanation}
                      {stepFeedback.correct && question.exampleAnswer && <div className="wh-model-answer">Model example: {question.exampleAnswer}</div>}
                    </div>
                  )}
                </div>
              )}

              {question.type === "wordOrder" && (
                <div className="wh-token-area">
                  <div className="wh-token-label">Your sentence</div>
                  <div className="wh-token-answer" aria-label="Ordered sentence">
                    {orderedTokens.map((token) => (
                      <button key={token.id} type="button" className="wh-token" onClick={() => moveTokenBack(token)} disabled={!!status} aria-label={`Remove ${token.text} from sentence`}>
                        {token.text}
                      </button>
                    ))}
                  </div>
                  <div className="wh-token-label">Word bank</div>
                  <div className="wh-token-bank" aria-label="Available words">
                    {availableTokens.map((token) => (
                      <button key={token.id} type="button" className="wh-token" onClick={() => moveTokenToAnswer(token)} disabled={!!status} aria-label={`Add ${token.text} to sentence`}>
                        {token.text}
                      </button>
                    ))}
                  </div>
                  {!status && <button className="wh-type-submit" type="button" onClick={submitWordOrder} disabled={availableTokens.length > 0 || orderedTokens.length === 0}>Submit Sentence</button>}
                </div>
              )}

              {question.type === "multiStage" && question.steps[challengeStepIndex] && (
                <div>
                  <div className="wh-stage-head">
                    <span>{fileMeta.label}</span>
                    <span>Stage {challengeStepIndex + 1}/{question.steps.length}</span>
                  </div>
                  <div className="wh-sentence" style={{ fontSize: 16 }}>{question.steps[challengeStepIndex].prompt}</div>
                  {question.steps[challengeStepIndex].type === "mcq" ? (
                    <div className="wh-options">
                      {question.steps[challengeStepIndex].options.map((opt) => {
                        let cls = "wh-option";
                        if (!stepFeedback && normalizeAnswerText(stepAnswer) === normalizeAnswerText(opt)) cls += " picked";
                        if (status && acceptedAnswerMatches(opt, question.steps[challengeStepIndex].acceptedAnswers)) cls += " reveal";
                        if (status && normalizeAnswerText(stepAnswer) === normalizeAnswerText(opt) && !acceptedAnswerMatches(opt, question.steps[challengeStepIndex].acceptedAnswers)) cls += " wrong";
                        return <button key={opt} type="button" className={cls} disabled={!!stepFeedback || !!status} onClick={() => setStepAnswer(opt)}>{opt}</button>;
                      })}
                    </div>
                  ) : (
                    <div className="wh-type-form">
                      <input className="wh-type-input" value={stepAnswer} onChange={(e) => setStepAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitChallengeStep(); } }} placeholder="Type the correction…" disabled={!!stepFeedback || !!status} autoFocus />
                    </div>
                  )}
                  {stepFeedback && <div className="wh-step-feedback">Answer saved. Review after all steps.</div>}
                  {status && question.steps.map((step,i)=><p key={step.id}>{i+1}. {step.acceptedAnswers.join(" / ")} — {step.explanation}</p>)}
                  {!status && (
                    <div className="wh-next">
                      {!stepFeedback
                        ? <button type="button" onClick={submitChallengeStep} disabled={!stepAnswer.trim()}>Submit Stage</button>
                        : <button type="button" onClick={advanceChallengeStep}>{challengeStepIndex + 1 < question.steps.length ? "Next stage →" : "Final verdict →"}</button>}
                    </div>
                  )}
                </div>
              )}

              {question.type === "multi" && (
                <>
                  <div className="wh-options">
                    {question.options.map((opt) => {
                      let cls = "wh-option wh-option-multi";
                      const isPicked = selectedMulti.includes(opt);
                      const isCorrectAnswer = question.correctAnswers.includes(opt);
                      if (!status && isPicked) cls += " picked";
                      if (status && isCorrectAnswer) cls += " reveal";
                      if (status && isPicked && !isCorrectAnswer) cls += " wrong";
                      return (
                        <button key={opt} className={cls} disabled={!!status} onClick={() => toggleMultiOption(opt)}>
                          <span className="wh-option-check">{isPicked ? "✓" : ""}</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {!status && (
                    <div className="wh-next">
                      <button onClick={submitMulti} disabled={selectedMulti.length === 0}>
                        Submit ({selectedMulti.length} picked)
                      </button>
                    </div>
                  )}
                </>
              )}

              {status && status !== "aiError" && (
                <div className={`wh-feedback ${status}`}>
                  {status === "correct" && <>EVIDENCE SECURED. {aiEvaluation?.grade && <><b>{aiEvaluation.grade}</b> — </>}<b>{question.target.label}</b> — {aiEvaluation?.feedback || question.target.explanation}</>}
                  {status === "correctAlternative" && <>Accepted as a valid English answer for this gap. It does not count as recall of <b>{question.target.label}</b>. {aiEvaluation?.feedback}</>}
                  {status === "wrong" && question.type === "multi" && <>Correct evidence: <b>{question.correctAnswers.join(" & ")}</b> — {question.target.explanation}</>}
                  {status === "wrong" && question.type === "multiStage" && <>The case was not fully cleared. {question.target.explanation}</>}
                  {status === "wrong" && question.type !== "multi" && question.type !== "multiStage" && <>Correct evidence: <b>{question.answer}</b> — {aiEvaluation?.feedback || question.target.explanation}</>}
                  {status === "close" && <>{aiEvaluation ? <>ALMOST. {aiEvaluation.feedback}{aiEvaluation.suggestedCorrection ? <> Suggested: <b>{aiEvaluation.suggestedCorrection}</b></> : null}</> : <>You found the right word. Spelling: <b>{typed}</b> ❌ <b>{question.answer}</b> ✅</>}</>}
                  {feedbackDetail && (
                    <div className="wh-feedback-card">
                      <div className="lead">Wrong Lead</div>
                      <div className="wh-feedback-pair">
                        <span>You chose: <b>{feedbackDetail.chosen}</b> — {feedbackDetail.chosenMeaning}</span>
                        <span>Correct evidence: <b>{feedbackDetail.correct}</b> — {feedbackDetail.correctMeaning}</span>
                        <span><b>Key difference:</b> {feedbackDetail.keyDifference}{feedbackDetail.aiLoading && <i style={{ opacity: 0.6 }}> (sharpening…)</i>}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {status === "wrong" && question.court && question.type !== "multiStage" && (
                <div className="wh-feedback-card">
                  <div className="lead">Grammar Court — Guilty</div>
                  <div>Correct or rewrite the evidence. Alternative correct corrections are accepted.</div>
                  <textarea className="wh-freeform" style={{ marginTop: 8, minHeight: 78 }} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (typed.trim() && !aiBusy) submitGrammarCorrection(); } }} placeholder="Write a corrected version…" disabled={aiBusy} />
                  <div className="wh-adaptive-actions" style={{ marginTop: 8, marginBottom: 0 }}>
                    <button className="primary" onClick={submitGrammarCorrection} disabled={aiBusy || !typed.trim()}>{aiBusy ? "Judging…" : "Submit Correction"}</button>
                  </div>
                  {grammarCorrectionResult && <div style={{ marginTop: 8 }}><b>{grammarCorrectionResult.correct ? "Not Guilty ✅" : "Needs another correction"}</b> — {grammarCorrectionResult.feedback}{grammarCorrectionResult.suggestedCorrection ? <> Suggested: <b>{grammarCorrectionResult.suggestedCorrection}</b></> : null}</div>}
                </div>
              )}

              {status === "aiError" && (
                <div className="wh-feedback-card">
                  <div className="lead">Evaluation unavailable</div>
                  <div>{aiError}</div>
                  <div className="wh-adaptive-actions" style={{ marginTop: 10, marginBottom: 0 }}>
                    <button className="primary" onClick={question.type === "freeform" ? submitFreeForm : submitTyped}>Retry AI Check</button>
                    <button onClick={continueAfterAiFailure}>Continue — don’t record mastery</button>
                  </div>
                </div>
              )}

              {status && status !== "aiError" && (
                <div className="wh-next">
                  <button onClick={nextQuestion}>
                    {roundIndex + 1 >= roundQueue.length ? "Finish case →" : "Next case →"}
                  </button>
                </div>
              )}

              <div className="wh-round-progress-track">
                <div
                  className="wh-round-progress-fill"
                  style={{ width: `${((roundIndex + (status ? 1 : 0)) / roundQueue.length) * 100}%` }}
                />
              </div>
            </div>
          </>
        )}

        {screen === "results" && currentLevel && lastRoundSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">CASE CLOSED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>{currentLevel.title}</div>
            <div className="wh-results-score"><b>{formatAccuracy(lastRoundSummary.accuracy)}%</b> accuracy — {lastRoundSummary.correct}/{lastRoundSummary.total} correct · {formatStars(lastRoundSummary.earnedStars)}</div>
            <div className="wh-results-learning"><span>{lastRoundSummary.improved} improved</span><span>{lastRoundSummary.masteredGained} mastered</span></div>
            {learningInsights.topConfusion && <div className="wh-results-note">Investigation note: watch the difference between {learningInsights.topConfusion.pair[0]} and {learningInsights.topConfusion.pair[1]}.</div>}
            <div className="wh-results-actions">
              <button className="secondary" onClick={retryLevel}>Retry case</button>
              {lastRoundSummary.passed && currentLevel.items.some((item) => item.kind === "word") && <button className="secondary" onClick={() => startFinalCase(currentLevelIndex)}>Final Case</button>}
              {lastRoundSummary.passed && hasNextLevel && <button className="primary" onClick={() => startLevel(nextLevelIndex)}>Next Case →</button>}
              <button className="secondary" onClick={backToLevels}>Back to levels</button>
            </div>
          </div>
        )}

        {screen === "reviewResults" && lastRoundSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">EVIDENCE REVIEWED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>Weak Evidence</div>
            <div className="wh-results-score"><b>{formatAccuracy(lastRoundSummary.accuracy)}%</b> accuracy — {lastRoundSummary.correct}/{lastRoundSummary.total} correct</div>
            <div className="wh-results-learning"><span>{lastRoundSummary.improved} improved</span><span>{lastRoundSummary.masteredGained} mastered</span><span>{lastRoundSummary.weakCount} still need review</span></div>
            <div className="wh-results-note">Review timing and weak-mode signals were updated from today’s evidence.</div>
            <div className="wh-results-actions">{weakCandidates.length > 0 && <button className="primary" onClick={startWeakReview}>Review More</button>}<button className="secondary" onClick={backToLevels}>Back to levels</button></div>
          </div>
        )}

        {screen === "finalReport" && currentLevel && finalRecallSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">RECALL SECURED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>FINAL CASE — {currentLevel.title}</div>
            <div className="wh-results-score">Recall: <b>{finalRecallSummary.correct}/{finalRecallSummary.total}</b> correct</div>
            <div className="wh-case-report">
              <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 18 }}>CASE REPORT</div>
              <div className="wh-results-note">Write 1–3 understandable sentences using the evidence words naturally. AI checks meaning, not just string presence.</div>
              <div className="wh-evidence-list">{finalCaseWords.map((word) => { const used = normalizeAnswerText(finalReportText).includes(normalizeAnswerText(word.word)); return <span key={word.word} className={`wh-evidence-chip ${used ? "used" : ""}`}>{used ? "✓ " : ""}{word.word}</span>; })}</div>
              <textarea value={finalReportText} onChange={(e) => setFinalReportText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (finalReportText.trim() && !aiBusy) finishFinalCaseReport(); } }} placeholder="Write your case report here…" disabled={aiBusy} />
              <div className="wh-results-note">Evidence text detected: {finalEvidenceUsed}/{finalCaseWords.length}. Semantic credit is decided only after evaluation.</div>
              {aiError && <div className="wh-feedback-card">{aiError}</div>}
            </div>
            <div className="wh-results-actions"><button className="primary" onClick={finishFinalCaseReport} disabled={!finalReportText.trim() || aiBusy}>{aiBusy ? "Examining report…" : "Submit Case Report"}</button><button className="secondary" onClick={backToLevels}>Leave Case</button></div>
          </div>
        )}

        {screen === "finalResults" && currentLevel && finalCaseResult && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">FINAL CASE SOLVED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>{currentLevel.title}</div>
            <div className="wh-results-score">Report quality: <b>{finalCaseResult.quality}</b></div>
            <div className="wh-evidence-list">{finalCaseResult.words.map((item) => <span key={item.word} className={`wh-evidence-chip ${item.productionSuccess ? "used" : ""}`}>{item.word} {item.productionSuccess ? "✅" : item.used ? "⚠️" : "❌"}</span>)}</div>
            <div className="wh-results-note">{finalCaseResult.feedback || "Production evidence was recorded only for words used with the correct meaning. Normal mastery requirements still apply."}</div>
            <div className="wh-results-actions"><button className="secondary" onClick={backToLevels}>Back to levels</button></div>
          </div>
        )}

        {screen === "live" && <Suspense fallback={<ScreenSkeleton />}><LiveChallenge player={livePlayer} levels={LEVELS} onExit={backToLevels} pools={pools} getSeen={() => progressExtrasRef.current.seenSentences || {}} onSeen={(q) => { markSentencesSeen(q); setLiveSeenTick((n) => n + 1); }} onRefresh={refreshLiveSentences} /></Suspense>}
        {screen === "leaderboard" && <Suspense fallback={<ScreenSkeleton />}><Leaderboard me={profile?.id} /></Suspense>}
        {screen === "profile" && <Suspense fallback={<ScreenSkeleton />}><ProfilePage stats={{ score, mastered: masteredWordCount, studyStreak, bestStudyStreak, attempted, badges: earnedBadgesCount, badgesTotal: BADGES.length }} onCopyBackup={handleQuickBackup} onDownloadBackup={downloadBackup} onOpenStats={() => setScreen("stats")} /></Suspense>}

        {screen === "speedResults" && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">Time's Up</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>Speed Round</div>
            <div className="wh-results-score">
              <b>{speedScore}</b> points — {speedCorrect}/{speedAnswered} correct · best combo x{speedBestCombo}
            </div>
            {speedScore >= bestSpeedScore && speedScore > 0 && (
              <div className="wh-results-unlock">🏆 New best score!</div>
            )}
            <div className="wh-results-actions">
              <button className="primary" onClick={startSpeedRound}>Play again</button>
              <button className="secondary" onClick={backToLevels}>Back to levels</button>
            </div>
          </div>
        )}
      </div>
      {showNav && <BottomNav screen={screen} isAdmin={isAdmin} onNavigate={(id) => setScreen(id)} />}
    </div>
  );
}
