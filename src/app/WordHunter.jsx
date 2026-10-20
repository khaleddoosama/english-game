import { cancelAiTasks } from "../lib/aiOperations.js";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Award, BarChart3, LogOut, Settings as SettingsIcon, CheckCircle2, Flame, HelpCircle, Lock, Play, Target, Trophy, Upload, Users, Volume2, X, Zap } from "lucide-react";
import { V2 } from "../engine/v2";
import { imageLinkOk } from "../features/media/media";
import { unlockAudioOnFirstTouch } from "../lib/sound";
unlockAudioOnFirstTouch(); // the first tap lets answer sounds play on phones
import { SessionView } from "../features/session/SessionView";
import { MaintenanceScreen, Splash, maintenanceBlocks, maintenanceText, useSignOut } from "../features/auth";
import { MASTERY_STAGE, getMasteryStage, isWordKey, courseLevelGroups, levelItemKey, setRuntimeDisabledModes, todayProgress } from "../engine/data";
import { SPEED_QUEUE_SIZE, SPEED_SECONDS, buildQuestion, buildSelectTwoQuestion, buildSpeedQuestion, buildTwoPeopleQuestion, getAdaptiveDifficulty, getAllowedModes, getStrongConfusion, legacyQuestionToV2, selectAdaptiveMode, setPoolsSnapshotForSession, shuffle, situationLeaks, speedQuestionV2, v2SessionFromEntries } from "../engine/questions";
import { evaluateFinalReport } from "../engine/ai";
import { normalizeAnswerText } from "../engine/text";
import { useQuestionReports } from "../features/reports";
import { useContentAdmin } from "../features/content-admin";
import { SCHEMA_VERSION, getBadgeProgress, getWeakWordCandidates, pickWeakMode } from "../engine/progress";
import { useAnswerRecording, useProgress, useProgressSave, useSaveQueue } from "../features/progress";
import { BottomNav, ScreenSkeleton, SyncStatus } from "../features/shell/Shell";
import { navigate, parseRoute, pathFor, useLocation } from "../lib/router";
import { FriendsPage, LOCAL_PEOPLE, Leaderboard, ProfilePage, ranksHiddenFromPlayers, ranksShown, useSocial } from "../features/social";
import { LiveChallenge, gapRefreshBatch, getLiveApi, liveLimits, useLivePlayer } from "../features/live";
import { LibraryRoutes, MyViewsHome, homeLimits, keepInLibrary, scopeIsEmpty, scopeOfView, useLibrary, useLibraryHome } from "../features/library";
import { getAppSettings, useAppSettings } from "../lib/appSettings";
import { useDataTransfer } from "../features/data";
import { gameContent, setGameContent, useContentLists, useContentSave } from "../features/content";
import { AskAiDrawer, StoryBuilder, contextCategoryOf, useAiGeneration, useAskAi, useStoryGeneration } from "../features/ai-helpers";
import CourseLevelsView from "../features/home/CourseLevelsView";
import HomeTabs from "../features/home/HomeTabs";
import LessonsView from "../features/home/LessonsView";
import { homeTabs, itemsScope, limitLessons, resolveHomeView } from "../features/home/homeState";
import { FinalReport, FinalResults, SpeedResults } from "../features/results/ResultScreens";
import { DeleteCategoryConfirm, ResetConfirm } from "../features/shell/ConfirmDialogs";
// Screens most players open rarely load on demand, keeping the first
// download small: Admin (and all its tools), Live, Leaderboard, Profile.
// The Admin tab reopens the admin page (and filters) used last.
const lastAdminPath = () => { try { const p = localStorage.getItem("wh-admin-path"); return p && p.startsWith("/admin") ? p : "/admin"; } catch { return "/admin"; } };
const masteredCountFor = (m) => Object.entries(m || {}).filter(([k, v]) => isWordKey(k) && V2.stage(v) === "Mastered").length;
const PLAY_SCREENS = new Set(["session", "finalReport", "finalResults", "speed", "speedResults"]);
const AdminPanel = lazy(() => import("../features/admin/AdminPanel").then((m) => ({ default: m.AdminPanel })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage"));
const ImportExport = lazy(() => import("../features/data/ImportExport"));
const StudyDashboard = lazy(() => import("../features/stats/StudyDashboard"));

export default function WordHunter({ repo, profile = null, isAdmin = true, onSignOut = null }) {
  const [loaded, setLoaded] = useState(false);
  const app = useAppSettings();
  // The announcement can be hidden per message (a new message shows again).
  const announcementKey = `wh-announcement-hidden:${app.announcement.length}:${app.announcement.slice(0, 40)}`;
  const [announcementHidden, setAnnouncementHidden] = useState(false);
  useEffect(() => { try { setAnnouncementHidden(localStorage.getItem(announcementKey) === "1"); } catch {} }, [announcementKey]);
  const hideAnnouncement = () => { setAnnouncementHidden(true); try { localStorage.setItem(announcementKey, "1"); } catch {} };
  const [storageWarning, setStorageWarning] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // The player in Live, friends and the library (local mode: one per browser tab).
  const livePlayer = useLivePlayer(profile);
  // Friends: the badges on the navigation (requests waiting, invitations waiting).
  const { friendsApi, counts: social, refresh: refreshSocial, badges: socialBadges } = useSocial({ player: livePlayer, enabled: loaded, liveFor: getLiveApi });
  // My library (views inside views); off until the dictionary has been moved to the new tables. In local mode it
  // asks social who is friends with whom (LOCAL_PEOPLE).
  const library = useLibrary({ enabled: loaded, me: livePlayer.id, knownWord: (k) => gameContent().words.some((w) => w.word === k), people: LOCAL_PEOPLE });
  const contentLists = useContentLists();
  const { customWords, setCustomWords, customGrammar, setCustomGrammar, customChallenges, setCustomChallenges, customCombos, setCustomCombos, customStories, setCustomStories, contentNoteRef, setContent, applySavedContent } = contentLists;
  const aiViewEpoch=useRef(0);

  // The player's progress (numbers, words' records, the open session, settings) and its saving: features/progress.
  const progress = useProgress({ repo, loaded, gameContent, onReports: (reports) => questionReportsApi.load(reports), onBadge: (badge) => setToast({ kind: "badge", text: badge.label }) });
  const { activeSession, setActiveSession, settings, setSettings, solvedStories, sessionLogs, dailyProgress } = progress;
  const { levelsCleared, setLevelsCleared, levelStats, setLevelStats, studyStreak, bestStudyStreak, lastStudyDate, bestSpeedScore, bestSpeedCombo } = progress;
  const { score, streak, bestStreak, attempted, mastery, setMastery, pools, setPools, confusions, setConfusions } = progress;
  const { progressExtrasRef, masteryRef, poolsRef, confusionsRef } = progress;
  useEffect(() => { setRuntimeDisabledModes(new Set(settings.enablePairModes ? [] : ["twopeople", "selecttwo"])); }, [settings.enablePairModes]);
  // Where we are comes from the address bar (see lib/router.js). The play
  // screens (a session and its result cards) all live under /play.
  const location = useLocation();
  const route = useMemo(() => parseRoute(location.path), [location.path]);
  const [playScreen, setPlayScreen] = useState("session");
  const lastSectionRef = useRef("practice");
  const screen = route.screen === "play" ? playScreen : route.screen === "notFound" ? "levels" : route.screen;
  useEffect(() => () => { aiViewEpoch.current++; cancelAiTasks(); setAiBusy(false); }, [screen, location.path]);
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
  function liveContent() { return { words: gameContent().words, grammar: gameContent().grammar, challenges: gameContent().challenges, combos: customCombos, stories: customStories, note: contentNoteRef.current }; }
  // Home shows one view at a time; My views needs the library, so without it Gateway shows.
  // A player (not the admin) sees only the words and rules in their own library on Home;
  // the whole course is the admin's.
  const { inbox: libraryInbox, refreshInbox: refreshLibraryInbox, keys: libraryKeys, roots: libraryRoots } = useLibraryHome({ library, screen });
  const { limit: limitHome, waiting: waitingForLibrary } = homeLimits({ status: library.status, isAdmin, keys: libraryKeys });
  const homeLevels = limitHome ? limitLessons(gameContent().levels, libraryKeys) : gameContent().levels;
  function startItemsPractice(title, items) {
    const scope = itemsScope(items);
    setCurrentLevelIndex(null);
    startPractice(title, null, { title, scope }, (w) => scope.words.has(w.word));
  }
  // Gateway is the owner's own view (the admin's); everyone else starts on By lesson.
  const homeView = resolveHomeView({ levelView: settings.levelView, isAdmin, libraryReady: library.status === "ready", roots: libraryRoots });
  const openRoot = homeView.startsWith("view:") ? homeView.slice(5) : null;
  function launchSession(session) { setActiveSession(session); setScreen("session"); }
  // One extra question style per word for Level Practice, built with the
  // adaptive-engine builders and converted to the V2 question shape.
  function buildPracticeExtra(wordObj, stage, rng = Math.random) {
    const allowed = new Set(getAllowedModes(gameContent(), wordObj));
    const byStage = stage === "Familiar" ? ["whoami", "idiomDetective", "story", "opposite"] : ["whoami", "idiomDetective", "story", "opposite", "twopeople", "selecttwo"];
    const clues = V2.outsideAntonyms(wordObj, gameContent().words);
    // Word Partners / Word Family come from collocations and wordFamily;
    // typed once the word is Learned.
    const typed = stage === "Learned" || stage === "Mastered";
    const partners = V2.collocationQuestion(wordObj, gameContent().words, rng, typed) || (typed ? V2.collocationQuestion(wordObj, gameContent().words, rng, false) : null);
    const family = V2.familyQuestion(wordObj, rng, typed) || (typed ? V2.familyQuestion(wordObj, rng, false) : null);
    const picture = V2.pictureQuestion(wordObj, gameContent().words, rng, typed, imageLinkOk);
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
      const options = V2.optionWords([wordObj], gameContent().words, 6, rng).filter((x) => x.word === wordObj.word || !V2.antonymsOf(x).some((a) => V2.norm(a) === V2.norm(clue))).slice(0, 4).map((x) => x.word);
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
        const pair = mode === "twopeople" ? buildTwoPeopleQuestion(gameContent(), wordObj, fresh) : buildSelectTwoQuestion(gameContent(), wordObj, fresh);
        if (!pair) return null;
        raw = { ...pair, modeId: mode, difficulty: 2 };
      } else raw = buildQuestion(gameContent(), mode, wordObj, poolsRef.current, { difficulty: 2 });
      // Multi-step authored challenges don't fit a single practice slot.
      const built = legacyQuestionToV2(gameContent(), raw, { kind: "word", wordObj }, mode);
      const q = built.length === 1 ? { ...built[0], ...(raw.sentences ? { sentences: raw.sentences } : {}) } : null;
      if (!q || q.noMastery || !q.targets?.length) return null;
      // Last line of defence: never show a prompt that spells out an answer.
      if ((q.answers || []).some((a) => String(a).length > 2 && normalizeAnswerText(q.prompt).includes(normalizeAnswerText(a)))) return null;
      return { ...q, id: `${wordObj.word}:${q.mode}` };
    } catch {
      return null;
    }
  }
  function launchStory(story) { try { launchSession(V2.storySession(story, gameContent().words, masteryRef.current)); } catch(e) { setToast({text:e.message}); } }
  // Live Challenge: words in the chosen lesson whose gap sentences have all
  // been read get new ones written in the background, for the next matches.
  function refreshLiveSentences(words) {
    const batch = gapRefreshBatch(words, poolsRef.current, progressExtrasRef.current.seenSentences || {});
    if (batch.length) triggerGeneration(batch, poolsRef.current);
  }
  // A round ends (or is left): recorded once (features/progress); then the Speed Round's or the Final Case's screen.
  function completeSession(session) {
    const out = recording.completeSession(session);
    if (out?.speed) {
      const st = out.speed;
      setSpeedScore(st.points); setSpeedAnswered(st.answered); setSpeedCorrect(st.correct); setSpeedBestCombo(st.bestCombo);
      setScreen("speedResults");
    } else if (out?.finalRecall) {
      setFinalRecallSummary(out.finalRecall);
      setScreen("finalReport");
    }
  }
  const [dataVersion, setDataVersion] = useState(0); // bumped whenever the game's copy (gameContent()) changes
  const [confirmAction, setConfirmAction] = useState(null); // null | 'reset' | 'wipe'
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState(null); // null | level object

  const [, setQuickBackupCopied] = useState(false);
  const [showFreshCopyPrompt, setShowFreshCopyPrompt] = useState(false);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(null);
  const [finalCaseWords, setFinalCaseWords] = useState([]);
  const [finalReportText, setFinalReportText] = useState("");
  const [finalRecallSummary, setFinalRecallSummary] = useState(null);
  const [finalCaseResult, setFinalCaseResult] = useState(null);


  // Speed Round — a timed review of mastered words. It plays in the normal
  // question box (SessionView, kind "speed"); these hold the last result.
  const [speedScore, setSpeedScore] = useState(0);
  const [speedAnswered, setSpeedAnswered] = useState(0);
  const [speedCorrect, setSpeedCorrect] = useState(0);
  const [speedBestCombo, setSpeedBestCombo] = useState(0);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);

  const storyApi = useStoryGeneration({ stories: customStories, setStories: setCustomStories, mastery, confusions, viewKey: `${screen} ${location.path}`, gameContent });

  const badgesOpen = screen === "badges", dashboardOpen = screen === "stats";
  const [toast, setToast] = useState(null);
  const { triggerGeneration, triggerVariantGeneration, keepGrammarFresh, clearPending: clearPendingGeneration } = useAiGeneration({ gameContent, liveContent, poolsRef, setPools, seenSentences: () => progressExtrasRef.current.seenSentences || {} });
  // What answers and finished rounds record in the progress (features/progress).
  const recording = useAnswerRecording({ progress, gameContent, onToast: setToast, generation: { triggerGeneration, triggerVariantGeneration, keepGrammarFresh } });
  const { markSentencesSeen, recordSessionResult, introduceWords } = recording;
  const questionReportsApi = useQuestionReports({ gameContent, progressExtrasRef, profile, liveContent, markSentencesSeen, touchSession: () => setActiveSession((session) => (session ? { ...session } : session)), poolsRef, setPools, triggerGeneration });
  const { reports: questionReports, quarantine: reportQuarantine } = questionReportsApi;
  // The admin's content changes (rename a word, merge categories, the levels editor...) and the progress that follows a rename.
  const { renameWord, updateWordFields, migrateRenamedProgress, mergeCategories, removeEmptyLevels, updateAdminContent, deleteLevelCategory, takePendingRenames, returnPendingRenames } = useContentAdmin({
    isAdmin, gameContent, setGameContent,
    content: { customWords, customGrammar, customChallenges, customCombos, customStories },
    set: { setCustomWords, setCustomGrammar, setCustomChallenges, setCustomCombos, setCustomStories, setDataVersion, setToast },
    progress: { masteryRef, setMastery, poolsRef, setPools, confusionsRef, setConfusions, setLevelStats, setLevelsCleared },
    followReportRename: questionReportsApi.followRename,
  });

  const clearedSet = useMemo(() => new Set(levelsCleared), [levelsCleared]);
  const weakCandidates = useMemo(() => getWeakWordCandidates(gameContent().words, mastery, confusions), [mastery, confusions, dataVersion]);
  const masteredOnlyWords = useMemo(() => gameContent().words.filter((w) => getMasteryStage(mastery[w.word], { kind: "word", obj: w }) === MASTERY_STAGE.MASTERED), [mastery, dataVersion]);
  const currentLevel = currentLevelIndex !== null ? gameContent().levels[currentLevelIndex] : null;
  const askAi = useAskAi({
    isAdmin, gameContent, setGameContent, liveContent, content: { customWords, customGrammar, customChallenges }, set: { setCustomWords, setDataVersion, setToast },
    contextCategory: contextCategoryOf(currentLevel, activeSession), onWordAdded: (entry) => keepInLibrary(library, entry),
  });
  const openAskAi = askAi.openAskAi;


  function getLevelStars(levelId) {
    return Math.max(Number(levelStats[levelId]?.stars || 0), clearedSet.has(levelId) ? 1 : 0);
  }

  function isLevelUnlocked(index) {
    return true; // TEMP: all levels unlocked for testing — revert to real progression below when ready
    // eslint-disable-next-line no-unreachable -- the real progression is switched off on purpose for now
    if (index === 0) return true;
    const level = gameContent().levels[index];
    const previous = gameContent().levels[index - 1];
    return getLevelStars(previous.id) >= 1 || getLevelStars(level.id) >= 1;
  }

  // Load saved progress AND any previously imported custom content once on
  // mount. Custom content must be merged first so the levels and badges are already
  // correct by the time we compute badge state from the saved mastery.
  // A failed load stops here (with a retry) instead of starting from empty
  // progress, which the next save would otherwise write over the real one.
  useEffect(() => {
    (async () => {
      let hadAnyData = false;
      let custom = null, raw = null;
      try {
        [custom, raw] = await Promise.all([repo.loadContent(), repo.loadProgress()]);
      } catch (e) {
        console.error("Could not load game data:", e);
        setLoadError(e?.message || "Network error");
        return;
      }
      if (applySavedContent(custom)) hadAnyData = true;

      try {
        if (raw) hadAnyData = true;
        progress.startFrom(raw, getAppSettings().newPlayerDefaults);
      } finally {
        setDataVersion((v) => v + 1);
        setLoaded(true);
        // Only the admin can bring content in; a player with no content just sees empty levels.
        if (!hadAnyData && isAdmin) setShowFreshCopyPrompt(true);
      }
    })();
  }, [repo]);

  // Saves wait 600 ms (a burst of changes becomes one save) and run at once when the page is hidden or left.
  const { debouncedSave, pendingSavesRef, runningSavesRef, contentWritesRef } = useSaveQueue();
  // Log out: finish any save first (up to 5 s), so the last answers and
  // edits aren't lost with the session.
  const { loggingOut, logOut } = useSignOut({ onSignOut, saves: { pendingSavesRef, runningSavesRef }, setToast });
  // Save progress whenever it changes (after initial load); the repo sends only what changed.
  useProgressSave({ repo, loaded, progress, debouncedSave, alsoOn: questionReports });

  // Save content whenever it changes (admin only — players read content, they never write it), and move pictures
  // stored inside the content to the word-images bucket. Separate from progress so a progress reset never touches
  // imported vocabulary.
  useContentSave({ loaded, isAdmin, repo, lists: contentLists, dataVersion, setDataVersion, saves: { debouncedSave, pendingSavesRef, contentWritesRef }, renames: { takePendingRenames, returnPendingRenames }, setStorageWarning });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // group (optional): one subCategory of the lesson, from levelGroups().
  function startLevel(index, group = null) {
    const level = gameContent().levels[index]; if(!level) return;
    const sessionTitle = group ? `${level.title} · ${group.title}` : level.title;
    if (limitHome) return startItemsPractice(sessionTitle, group ? group.items : (homeLevels.find((l) => l.id === level.id)?.items || []));
    setCurrentLevelIndex(index);
    startPractice(sessionTitle, level.title, group ? { title: sessionTitle, ...(group.id ? { [group.field === "unit" ? "unit" : "subCategory"]: group.id } : { noGroup: group.field }) } : {}, (w) => w.category === level.title);
  }
  // A course level (A1.2 …) from every lesson: the whole level, one of its
  // sessions ({ unit }), or its words in no session ({ noUnit }). No
  // level: the words that have no course level yet.
  function startCourseLevel(level, part = null) {
    setCurrentLevelIndex(null);
    const title = !level ? "No course level" : part?.unit ? `${level.id} · ${part.title || part.unit}` : part?.noUnit ? `${level.id} · Other words` : level.id;
    const opts = !level ? { noCourseLevel: true } : { courseLevel: level.id, ...(part?.unit ? { unit: part.unit } : part?.noUnit ? { noGroup: "unit" } : {}) };
    const unitsOf = (w) => (Array.isArray(w.units) ? w.units : []);
    const inRound = (w) => (level ? V2.courseLevelOf(w) === level.id && (!part?.unit || unitsOf(w).includes(part.unit)) && (!part?.noUnit || !unitsOf(w).length) : !V2.courseLevelOf(w));
    startPractice(title, null, { title, ...opts }, inRound);
  }
  function startPractice(sessionTitle, category, narrow, inRound) {
    // New-word intake follows the last round here: a strong round (90%+)
    // earns two extra new words, a rough one (under 60%) holds back two so
    // the missed words get room. 0 in Settings still means none.
    const lastRound = sessionLogs.find((log) => log.kind === "practice" && log.title === sessionTitle && log.total > 0);
    const lastAccuracy = lastRound ? lastRound.correct / lastRound.total : null;
    const baseNew = settings.newWordsPerRound;
    const newWordsPerRound = baseNew === 0 || lastAccuracy === null ? baseNew : lastAccuracy >= 0.9 ? Math.min(10, baseNew + 2) : lastAccuracy < 0.6 ? Math.max(1, baseNew - 2) : baseNew;
    const session = V2.practice(liveContent(), masteryRef.current, category, Math.random, reportQuarantine, { questionsPerRound: settings.questionsPerRound, newWordsPerRound, pools: poolsRef.current, extraQuestion: buildPracticeExtra, confusions: confusionsRef.current, seen: progressExtrasRef.current.seenSentences || {}, ...narrow });
    // Words whose gap sentences have all been read get new ones written now,
    // so the next rounds have fresh sentences instead of shrinking.
    const seenNow = progressExtrasRef.current.seenSentences || {};
    const exhausted = gameContent().words.filter((w) => inRound(w) && V2.known(masteryRef.current[w.word]) && /_{2,}/.test(w.gap || "") && V2.poolItems(w, "gap", poolsRef.current?.[w.word]?.gap).every((it) => V2.seenRecently(seenNow, it.text))).slice(0, 8);
    if (exhausted.length) triggerGeneration(exhausted.map((w) => ({ word: w.word, poolType: "gap" })), poolsRef.current);
    if (newWordsPerRound > baseNew && session.introductions.length > baseNew) setToast({ text: `Strong last round here — ${session.introductions.length} new words this time.` });
    launchSession(session);
  }
  // A round from one of my views (and, with deep, the views inside it).
  async function startViewPractice(viewId, deep = true, name = "My view") {
    if (library.status !== "ready") return;
    try {
      const scope = await scopeOfView(library, viewId, deep);
      if (scopeIsEmpty(scope)) { setToast({ text: "This view is empty. Add some words first." }); return; }
      setCurrentLevelIndex(null);
      startPractice(name, null, { title: name, scope }, (w) => scope.words.has(w.word));
    } catch (e) { setToast({ text: e.message }); }
  }
  function startWeakReview() {
    const picked = weakCandidates.slice(0, settings.weakReviewSize);
    if (!picked.length) return;
    let lastMode = null;
    const queue = picked.map(({ word, stats }) => {
      let mode = pickWeakMode(gameContent(), word, stats, confusionsRef.current, reportQuarantine);
      if (mode === lastMode && !getWeakWordCandidates([word], { [word.word]: stats }, confusionsRef.current)[0]?.weakModes?.includes(mode)) {
        mode = selectAdaptiveMode(gameContent(), word, stats, { sessionType: "weak", confusion: getStrongConfusion(word, confusionsRef.current), lastMode, quarantine: reportQuarantine });
      }
      const entry = { kind: "word", wordObj: word, mode, difficulty: getAdaptiveDifficulty(word, stats, mode), confusionPartner: getStrongConfusion(word, confusionsRef.current)?.partner || null };
      lastMode = mode;
      return entry;
    }).filter((entry, i, arr) => i === 0 || entry.wordObj.word !== arr[i - 1].wordObj.word);
    setCurrentLevelIndex(null);
    setPoolsSnapshotForSession(poolsRef.current);
    launchSession(v2SessionFromEntries(gameContent(), queue,{kind:"weak",title:"Weak Evidence",idPrefix:"weak"}));
  }

  function startFinalCase(index) {
    const level = gameContent().levels[index];
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
    setPoolsSnapshotForSession(poolsRef.current);
    launchSession(v2SessionFromEntries(gameContent(), selectedWords.map((wordObj)=>({kind:"word",wordObj,mode:"gapTyping",difficulty:4})),{kind:"finalRecall",title:`Final Case — ${level.title}`,idPrefix:"final"}));
  }

  function backToLevels() { setScreen("levels"); setCurrentLevelIndex(null); }



















  async function finishFinalCaseReport() {
    const epoch=aiViewEpoch.current;
    if (!finalCaseWords.length || !finalReportText.trim() || aiBusy) return;
    setAiBusy(true); setAiError(null);
    try {
      const evaluation = await evaluateFinalReport(finalCaseWords, finalReportText.trim());
      if(epoch!==aiViewEpoch.current)return;
      setFinalCaseResult(evaluation);
      recording.applyFinalReport(finalCaseWords, evaluation);
      setScreen("finalResults");
    } catch (e) { if(epoch!==aiViewEpoch.current)return; console.error("Final Case AI failed:", e); setAiError("AI evaluation is unavailable. Retry the report, or return without changing mastery."); }
    finally { if(epoch===aiViewEpoch.current)setAiBusy(false); }
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
      for (let tries = 0; tries < 6; tries++) { raw = buildSpeedQuestion(gameContent(), masteredOnlyWords); if (!raw || raw.answer !== queue.at(-1)?.answers[0]) break; }
      if (!raw) break;
      queue.push(speedQuestionV2(raw, i));
    }
    if (!queue.length) { setToast({ text: "No short questions with safe options are available." }); return; }
    launchSession({ kind: "speed", id: `speed-${Date.now()}`, title: "Speed Round", queue, index: 0, answers: [], introductions: [], seconds: settings.speedSeconds || SPEED_SECONDS, deadline: Date.now() + (settings.speedSeconds || SPEED_SECONDS) * 1000 });
  }

  async function handleReset() {
    await progress.reset({ onError: () => setStorageWarning("Progress couldn't be reset on the server. Check your connection and try again.") });
    clearPendingGeneration();
    setScreen("levels"); setCurrentLevelIndex(null);
    // Content is intentionally left alone here.
  }
  function backupPayload() {
    const content = V2.contentOnly(liveContent());
    return {
      ...progressExtrasRef.current, ...content, kind: "backup", schemaVersion: SCHEMA_VERSION, contentSchemaVersion: 2,
      activeSession, levelOrder: gameContent().levelOrder, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings,
    };
  }
  // ---- Import & export (/data, and Admin -> Data & backup), and the Profile page's backups -------------
  const { exportFile, checkImport, applyImport, aiFixImport, downloadBackup, handleQuickBackup, wipeEverything } = useDataTransfer({
    isAdmin, gameContent, setGameContent, exportedBy: profile?.username || "local", liveContent, backupPayload, contentNoteRef,
    setContent,
    migrateRenamedProgress, applyRestoredProgress: progress.restore, resetProgress: handleReset, wipeContent: () => repo.wipeContent(), set: { setDataVersion, setShowFreshCopyPrompt, setToast, setQuickBackupCopied },
  });
  const contentCounts = { words: gameContent().words.length, grammar: gameContent().grammar.length, challenges: gameContent().challenges.length, stories: customStories.length, combos: customCombos.length, categories: gameContent().levelOrder.length };
  const dataTools = { exportFile, checkImport, applyImport, aiFixImport, contentCounts, progressCounts: { score, words: Object.keys(mastery).filter(isWordKey).length, mastered: masteredCountFor(mastery), sessions: sessionLogs.length }, onResetProgress: () => setConfirmAction("reset"), onWipeEverything: () => setConfirmAction("wipe") };

  const earnedBadgesCount = gameContent().badges.filter((b) => getBadgeProgress(b, { mastery, bestStreak, levels: gameContent().levels }).earned).length;
  const totalLevelsCleared = levelsCleared.length;
  const finalEvidenceUsed = finalCaseWords.filter((word) => { const n = normalizeAnswerText(finalReportText); return n.includes(normalizeAnswerText(word.word)); }).length;

  const masteredWordCount = Object.entries(mastery).filter(([key, stats]) => isWordKey(key) && V2.stage(stats) === "Mastered").length;
  const showNav = !["session", "finalReport", "speed", "admin"].includes(screen);

  // Addresses that can't be shown go home (replacing, so Back still works):
  // unknown paths, admin pages for players, and /play with nothing to play.
  useEffect(() => {
    if (!loaded) return;
    const nothingToPlay = route.screen === "play" && playScreen === "session" && (!activeSession || activeSession.completed);
    const hiddenBoard = route.screen === "leaderboard" && !ranksShown(app, isAdmin);
    if (route.screen === "notFound" || (route.screen === "admin" && !isAdmin) || nothingToPlay || hiddenBoard) navigate("/", { replace: true });
  }, [loaded, route, playScreen, activeSession, isAdmin, app.leaderboard]);

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
  // Maintenance (Admin -> Settings): players wait, the admin plays on.
  if (maintenanceBlocks(app, isAdmin)) return <MaintenanceScreen message={maintenanceText(app)} />;

  return (
    <div className={`wh-root${showNav ? " has-nav" : ""}${screen === "admin" ? " screen-admin" : ""}${settings.textSize !== "normal" ? ` text-${settings.textSize}` : ""}${settings.shortcuts ? "" : " no-shortcuts"}${settings.reduceMotion ? " reduce-motion" : ""}`}>

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
              <div className="wh-sub">{profile?.username && profile.id !== "local" ? `Hi ${profile.username} · ` : ""}{totalLevelsCleared}/{gameContent().levels.length} levels cleared</div>
            </div>
            <div className="ui-header-actions">
              <SyncStatus repo={repo} />
              {onSignOut && <button className="wh-icon-btn ui-logout" onClick={logOut} disabled={loggingOut} title="Log out"><LogOut size={14} /><span>{loggingOut ? "Logging out…" : "Log out"}</span></button>}
            </div>
          </div>
          <div className="wh-stats ui-stat-row">
            <span className="ui-stat" title="Score"><b>{score}</b> pts</span>
            <span className="ui-stat wh-stat-streak" title="Answer streak"><Flame size={14} /> {streak}</span>
            <span className="ui-stat" title="Study streak (days in a row)"><b>{studyStreak}</b>d streak</span>
            <button className="wh-icon-btn ui-stat" onClick={() => setScreen(badgesOpen ? "levels" : "badges")} aria-pressed={badgesOpen} title="View badges">
              <Trophy size={13} /> {earnedBadgesCount}/{gameContent().badges.length}
            </button>
            <button className="wh-icon-btn ui-stat" onClick={() => setScreen(dashboardOpen ? "levels" : "stats")} aria-pressed={dashboardOpen} title="View stats dashboard">
              <BarChart3 size={13} /> Stats
            </button>
            <button className="wh-icon-btn ui-stat" onClick={() => setScreen(screen === "settings" ? "levels" : "settings")} aria-pressed={screen === "settings"} title="Settings" aria-label="Settings">
              <SettingsIcon size={13} />
            </button>
          </div>
          <div className="wh-ask-bar">
            <input value={askAi.term} onChange={event=>askAi.setTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();openAskAi(askAi.term);}}} placeholder="Look up a word…" aria-label="Ask AI about a word" enterKeyHint="search" />
            <button className="wh-icon-btn" onClick={()=>openAskAi(askAi.term)} title="Ask AI"><HelpCircle size={15}/><span className="ui-hide-narrow"> Ask AI</span></button>
            <button className="wh-icon-btn" onClick={()=>{const term=askAi.term.trim();if(term)askAi.setListenTerm(term);}} title="Hear it pronounced" aria-label="Listen"><Volume2 size={15}/></button>
          </div>
        </header>
        <AskAiDrawer ask={askAi} isAdmin={isAdmin} />
        {screen==="admin"&&isAdmin&&<Suspense fallback={<ScreenSkeleton />}><AdminPanel route={route} profile={profile} onSignOut={onSignOut ? logOut : null} loggingOut={loggingOut} score={score} studyStreak={studyStreak} bestStudyStreak={bestStudyStreak} content={{...liveContent(),levels:gameContent().levelOrder.map(title=>({id:`cat-${title}`,title}))}} mastery={mastery} confusions={confusions} reports={questionReports} activeSession={activeSession} sessionLogs={sessionLogs} estimatedStorageBytes={JSON.stringify({...progressExtrasRef.current,activeSession,score,streak,bestStreak,attempted,mastery,levelsCleared,levelStats,studyStreak,bestStudyStreak,lastStudyDate,pools,bestSpeedScore,bestSpeedCombo,confusions}).length} settings={settings} onUpdateSettings={setSettings} onClearActiveSession={()=>setActiveSession(null)} onUpdate={updateAdminContent} onRenameWord={renameWord} onResolveReport={questionReportsApi.resolve} onReopenReport={questionReportsApi.reopen} onReviewReport={questionReportsApi.review} onRetireVariant={questionReportsApi.retire} onDeleteReport={questionReportsApi.remove} onMergeCategories={mergeCategories} onRemoveEmptyLevels={removeEmptyLevels} onResetProgress={()=>setConfirmAction("reset")} onWipeEverything={()=>setConfirmAction("wipe")} onClose={()=>setScreen("levels")} dataTools={dataTools}/></Suspense>}
        {confirmAction && <ResetConfirm action={confirmAction} onConfirm={confirmAction === "reset" ? handleReset : wipeEverything} onClose={() => setConfirmAction(null)} />}
        {deleteCategoryTarget && <DeleteCategoryConfirm level={deleteCategoryTarget} onConfirm={deleteLevelCategory} onClose={() => setDeleteCategoryTarget(null)} />}

        {badgesOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Case Archive — Badges</span>
              <button onClick={() => setScreen("levels")} aria-label="Close badges panel">
                <X size={15} />
              </button>
            </div>
            <div className="wh-badges-grid">
              {gameContent().badges.map((b) => {
                const { done, total, earned } = getBadgeProgress(b, { mastery, bestStreak, levels: gameContent().levels });
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

        {dashboardOpen && <Suspense fallback={<ScreenSkeleton />}><StudyDashboard levels={gameContent().levels} mastery={mastery} sessionLogs={sessionLogs} dailyHistory={progressExtrasRef.current.dailyHistory} confusions={confusions} levelStats={levelStats}
          studyStreak={studyStreak} bestStudyStreak={bestStudyStreak} today={todayProgress(dailyProgress)} dailyGoal={settings.dailyGoal}
          weakReviewCount={Math.min(weakCandidates.length, settings.weakReviewSize)} onWeakReview={startWeakReview} onPlayLevel={(i) => startLevel(i)} onBack={backToLevels} /></Suspense>}

        {screen === "levels" && <>
          {app.announcement && !announcementHidden && <div className={`wh-announcement ${app.announcementTone}`} role="status"><p>{app.announcement}</p><button aria-label="Hide this message" onClick={hideAnnouncement}><X size={15} /></button></div>}
          {showFreshCopyPrompt && <div className="wh-fresh-copy-banner">
            <p><b>Fresh copy detected.</b> No saved progress or content found here — if you have a backup from a previous version, restore it now before you start playing.</p>
            <div className="wh-regen-actions">
              <button className="wh-level-btn" onClick={()=>{setShowFreshCopyPrompt(false);setScreen("data");}}>Open Import &amp; Export</button>
              <button className="wh-back-btn wh-nav-btn" onClick={()=>setShowFreshCopyPrompt(false)}>Dismiss</button>
            </div>
          </div>}
          <nav className="wh-v2-nav" aria-label="Game sections">{[["practice","Practice"],["stories","Stories"]].map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}</nav>
          {activeSession&&!activeSession.completed&&<button className="wh-level-btn" onClick={()=>setScreen("session")}>Resume {activeSession.title} ({Math.min(activeSession.index+1,activeSession.queue.length)}/{activeSession.queue.length})</button>}
          {section==="practice"&&(()=>{const day=todayProgress(dailyProgress);const goal=settings.dailyGoal;const done=day.answered>=goal;return <div className={`wh-daily-goal ${done?"done":""}`}><div className="wh-daily-goal-head"><b>{done?<><CheckCircle2 size={15}/> Daily goal reached</>:<><Target size={15}/> Today's goal</>}</b><span>{day.answered} / {goal} questions{day.answered?` · ${Math.round(day.correct/day.answered*100)}% correct`:""}</span></div><div className="wh-daily-goal-bar"><span style={{width:`${Math.min(100,day.answered/goal*100)}%`}}/></div>{done&&day.answered>goal&&<small>+{day.answered-goal} bonus questions today</small>}</div>;})()}
          {section==="stories"&&<div className="wh-panel"><h2>Stories</h2>
            <StoryBuilder story={storyApi} isAdmin={isAdmin} gameContent={gameContent} />
            {!customStories.length&&<p>No authored stories loaded. Import a Content v2 file to add them.</p>}{[...customStories].sort((a,b)=>a.targetWords.filter(w=>!V2.known(mastery[V2.findWord(gameContent().words,w)?.word])).length-b.targetWords.filter(w=>!V2.known(mastery[V2.findWord(gameContent().words,w)?.word])).length).map(story=>{const fresh=story.targetWords.filter(w=>!V2.known(mastery[V2.findWord(gameContent().words,w)?.word])).length;const record=solvedStories.find(e=>e.id===story.id);return <article className="wh-v2-learn" key={story.id}><strong>{story.title}{record&&<span className="wh-story-solved-flag"><CheckCircle2 size={13}/> Solved · {record.correct}/{record.total}</span>}</strong><p>{story.questions.length}{story.grammarQuestions?.length?` + ${story.grammarQuestions.length} grammar`:""} questions · {fresh?`${fresh} new words: preview first`:"Ready for review"}</p><button className="wh-level-btn" onClick={()=>launchStory(story)}>{record?"Play again":"Open story"}</button></article>;})}</div>}
        </>}
        {screen === "session" && <SessionView session={activeSession} onChange={setActiveSession} onFinish={completeSession} onBack={()=>setScreen("levels")} words={gameContent().words} onIntroduce={introduceWords} onReport={questionReportsApi.report} onReviewReport={questionReportsApi.review} onWithdrawReport={questionReportsApi.remove} onUpdateWord={isAdmin?updateWordFields:undefined} sound={settings.sound} prefs={{ autoAdvanceMs: settings.autoAdvanceMs, hints: settings.hints, speakWord: settings.speakWord }} onToggleSound={()=>setSettings(prev=>({...prev,sound:!prev.sound}))} onResult={recordSessionResult} onAskWord={openAskAi}/>}


        {screen === "levels" && section === "practice" && (
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

        {screen === "levels" && section === "practice" && (
          <div className="wh-speed-card wh-live-card">
            <div className="wh-speed-card-icon"><Users size={22} /></div>
            <div className="wh-speed-card-info">
              <div className="wh-speed-card-title">Live Challenge</div>
              <div className="wh-speed-card-meta">Send a link to 1–9 friends · same questions, everyone at their own pace</div>
            </div>
            <button className="wh-speed-card-btn" onClick={() => setScreen("live")}><Play size={13} /> Play</button>
          </div>
        )}

        {screen === "levels" && section === "practice" && (gameContent().levels.length > 0 || library.status === "ready") && (
          <HomeTabs tabs={homeTabs({ isAdmin, libraryReady: library.status === "ready", roots: libraryRoots })} active={homeView} libraryReady={library.status === "ready"}
            onSelect={(id) => setSettings((prev) => ({ ...prev, levelView: id }))} onNew={() => navigate("/library?new=1")} onCatalog={() => navigate("/catalog")} />
        )}

        {/* Gateway (admin): the course's levels (A1.2 …) from every lesson, each split into its sessions. */}
        {screen === "levels" && section === "practice" && waitingForLibrary && (homeView === "course" || homeView === "lesson") && <ScreenSkeleton />}
        {screen === "levels" && section === "practice" && !waitingForLibrary && homeView === "course" && (() => {
          const { levels, none } = limitHome ? courseLevelGroups(gameContent().words.filter((w) => libraryKeys.words.has(w.word)), gameContent().grammar.filter((g) => libraryKeys.rules.has(g.id))) : courseLevelGroups(gameContent().words, gameContent().grammar);
          return <CourseLevelsView levels={levels} none={none} mastery={mastery} limited={limitHome} onPlay={startItemsPractice} onStartLevel={startCourseLevel} />;
        })()}

        {/* My views: read only. Editing happens in the library page (Profile › My library). */}
        {screen === "levels" && section === "practice" && openRoot && library.status === "ready" && (
          <Suspense fallback={<ScreenSkeleton />}>
            <MyViewsHome key={openRoot} rootId={openRoot} api={library.api} offers={libraryInbox} onPractice={startViewPractice} ids={library.ids} mastery={mastery} words={gameContent().words} grammar={gameContent().grammar} />
          </Suspense>
        )}

        {screen === "levels" && section === "practice" && !waitingForLibrary && homeView === "lesson" && (
          <LessonsView levels={homeLevels} indexOf={(level) => gameContent().levels.findIndex((l) => l.id === level.id)} mastery={mastery} isAdmin={isAdmin} emptyLibrary={limitHome && !homeLevels.length}
            isUnlocked={isLevelUnlocked} clearedSet={clearedSet} starsOf={getLevelStars} onStart={startLevel} onFinalCase={startFinalCase} onDelete={setDeleteCategoryTarget}
            onOpenLibrary={() => navigate("/library")} onOpenCatalog={() => navigate("/catalog")} />
        )}


        {screen === "finalReport" && currentLevel && finalRecallSummary && (
          <FinalReport level={currentLevel} recall={finalRecallSummary} words={finalCaseWords} text={finalReportText} onText={setFinalReportText} evidenceUsed={finalEvidenceUsed} busy={aiBusy} error={aiError} onSubmit={finishFinalCaseReport} onBack={backToLevels} />
        )}
        {screen === "finalResults" && currentLevel && finalCaseResult && <FinalResults level={currentLevel} result={finalCaseResult} onBack={backToLevels} />}

        {screen === "live" && <Suspense fallback={<ScreenSkeleton />}><LiveChallenge gameContent={gameContent} player={livePlayer} friendsApi={friendsApi} onSocialChanged={refreshSocial} library={library.status === "ready" ? library : null} levels={gameContent().levels} code={route.code} sound={settings.sound} onOpenCode={(c) => navigate(pathFor("live", { code: c }))} onExit={backToLevels} pools={pools} getSeen={() => progressExtrasRef.current.seenSentences || {}} onSeen={(q) => { markSentencesSeen(q); progress.extrasChanged(); }} onRefresh={refreshLiveSentences} limits={liveLimits(app, settings, isAdmin)} /></Suspense>}
        {screen === "data" && <Suspense fallback={<ScreenSkeleton />}><ImportExport variant="game" isAdmin={isAdmin} tools={dataTools} onBack={backToLevels} /></Suspense>}
        {screen === "settings" && <Suspense fallback={<ScreenSkeleton />}><SettingsPage settings={settings} app={app} onChange={setSettings} onBack={backToLevels} onOpen={(id) => setScreen(id)} isAdmin={isAdmin} /></Suspense>}
        {screen === "leaderboard" && <Suspense fallback={<ScreenSkeleton />}><Leaderboard me={profile?.id} friendsApi={friendsApi} hiddenForPlayers={ranksHiddenFromPlayers(app, isAdmin)} /></Suspense>}
        {screen === "profile" && <Suspense fallback={<ScreenSkeleton />}><ProfilePage social={social} libraryOn={library.status === "ready"} libraryInbox={libraryInbox} onSignOut={onSignOut ? logOut : null} stats={{ score, mastered: masteredWordCount, studyStreak, bestStudyStreak, attempted, badges: earnedBadgesCount, badgesTotal: gameContent().badges.length }} onCopyBackup={handleQuickBackup} onDownloadBackup={downloadBackup} onOpenStats={() => setScreen("stats")} /></Suspense>}
        {(screen === "join" || screen === "catalog" || screen === "library") && (
          <LibraryRoutes screen={screen} library={library} route={route} fallback={<ScreenSkeleton />} isAdmin={isAdmin} words={gameContent().words} grammar={gameContent().grammar}
            levels={screen === "library" ? courseLevelGroups(gameContent().words, gameContent().grammar).levels : []} friendsApi={friendsApi} onPractice={startViewPractice} onAskWord={openAskAi} onInboxChanged={refreshLibraryInbox}
            onJoined={(out, open) => { refreshLibraryInbox(); if (open) { setSettings((prev) => ({ ...prev, levelView: out?.view ? `view:${out.view}` : "lesson" })); navigate("/"); } }} />
        )}
        {screen === "friends" && <Suspense fallback={<ScreenSkeleton />}><FriendsPage api={friendsApi} onChanged={refreshSocial} local={friendsApi.mode === "local"} /></Suspense>}

        {screen === "speedResults" && <SpeedResults score={speedScore} correct={speedCorrect} answered={speedAnswered} bestCombo={speedBestCombo} best={bestSpeedScore} onAgain={startSpeedRound} onBack={backToLevels} />}
      </div>
      {showNav && <BottomNav screen={screen === "friends" || screen === "library" || screen === "catalog" ? "profile" : screen === "join" ? "levels" : screen} badges={socialBadges} isAdmin={isAdmin} showRanks={ranksShown(app, isAdmin)} onNavigate={(id) => setScreen(id)} />}
    </div>
  );
}
