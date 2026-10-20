import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, emptyProgressData, migrateProgressData, normalizeSettings } from "../../engine/progress";
import { nextStudyStreakState } from "../../engine/data";
import { earnedBadgeIds, newBadges, progressToSave, refreshDue, resetState, startingSettings } from "./progressRules";

// The player's progress as the game holds it: the numbers (score, streaks, words' records, levels, pools,
// confusions...), the open session and the settings, with refs for code that must read the newest value at once.
// It puts a loaded, merged or restored progress object on screen, resets it, records study days, shows each badge the
// first time it is earned, and (online) takes in another device's changes when the game comes back to the foreground.
// repo          the repo (loadProgress is called by the shell; this uses refreshProgress, onMerged, resetProgress)
// loaded        the game has opened (nothing is saved or shown as new before)
// gameContent() the game's copy of the content (badges and levels)
// onReports     called with the reports of a progress object put on screen (question reports keep their own list)
// onBadge       called with each badge earned for the first time
// Docs: docs/modules/progress/progress-state.md.
export function useProgress({ repo, loaded, gameContent, onReports, onBadge }) {
  const [activeSession, setActiveSession] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [solvedStories, setSolvedStories] = useState([]);
  const [sessionLogs, setSessionLogs] = useState([]);
  const [dailyProgress, setDailyProgress] = useState(null);
  const [levelsCleared, setLevelsCleared] = useState([]);
  const [levelStats, setLevelStats] = useState({});
  const [studyStreak, setStudyStreak] = useState(0);
  const [bestStudyStreak, setBestStudyStreak] = useState(0);
  const [lastStudyDate, setLastStudyDate] = useState(null);
  const [bestSpeedScore, setBestSpeedScore] = useState(0);
  const [bestSpeedCombo, setBestSpeedCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [mastery, setMastery] = useState({});
  const [pools, setPools] = useState({});
  const [confusions, setConfusions] = useState({});
  // The rest of the progress object (round log, the day's count, reports, read sentences...), changed in place by
  // the code that owns each part and saved with the next save.
  const progressExtrasRef = useRef({});
  // Bumped when a change to the extras alone must be saved (Live marks the sentences a player has read).
  const [extrasTick, setExtrasTick] = useState(0);
  const masteryRef = useRef(mastery), poolsRef = useRef(pools), confusionsRef = useRef(confusions);
  const studyRef = useRef({ studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null });
  const seenBadgesRef = useRef(null);
  // A restored backup replaces the saved progress instead of merging with it (read by the next save).
  const restoringRef = useRef(false);
  const latest = useRef({});
  latest.current = { onReports, onBadge };
  useEffect(() => { poolsRef.current = pools; }, [pools]);
  useEffect(() => { masteryRef.current = mastery; }, [mastery]);
  useEffect(() => { confusionsRef.current = confusions; }, [confusions]);
  useEffect(() => { studyRef.current = { studyStreak, bestStudyStreak, lastStudyDate }; }, [studyStreak, bestStudyStreak, lastStudyDate]);

  // Puts a progress object into the game's state (on start, and when
  // another device's changes were merged in).
  function apply(data) {
    progressExtrasRef.current = data; setActiveSession(data.activeSession || null); setDailyProgress(data.dailyProgress || null); latest.current.onReports?.(data.reports); setSolvedStories(Array.isArray(data.solvedStories) ? data.solvedStories : []); setSessionLogs(Array.isArray(data.sessionLogs) ? data.sessionLogs : []);
    setScore(data.score); setStreak(data.streak); setBestStreak(data.bestStreak); setAttempted(data.attempted);
    setMastery(data.mastery); masteryRef.current = data.mastery;
    setLevelsCleared(data.levelsCleared); setLevelStats(data.levelStats); setPools(data.pools); poolsRef.current = data.pools;
    setStudyStreak(data.studyStreak); setBestStudyStreak(data.bestStudyStreak); setLastStudyDate(data.lastStudyDate);
    studyRef.current = { studyStreak: data.studyStreak, bestStudyStreak: data.bestStudyStreak, lastStudyDate: data.lastStudyDate };
    setBestSpeedScore(data.bestSpeedScore); setBestSpeedCombo(data.bestSpeedCombo);
    setConfusions(data.confusions); confusionsRef.current = data.confusions;
  }

  // The game opens with the loaded progress (`raw`, null for a new player). The badges already earned are not shown
  // as new. A progress object that cannot be read leaves the starting state and logs why.
  function startFrom(raw, newPlayerDefaults) {
    try {
      const data = raw ? migrateProgressData(raw) : emptyProgressData();
      apply(data);
      // A new player starts with the admin's defaults (Admin -> Settings).
      setSettings(startingSettings(raw, data, newPlayerDefaults));
      seenBadgesRef.current = earnedBadgeIds(gameContent().badges, { mastery: data.mastery, bestStreak: data.bestStreak, levels: gameContent().levels });
    } catch (e) {
      console.error("Could not read progress:", e);
      seenBadgesRef.current = new Set();
    }
  }

  // A restored backup replaces the progress (saved as a replacement, not merged; see restoringRef).
  function restore(restored) {
    restoringRef.current = true;
    progressExtrasRef.current = restored; setActiveSession(restored.activeSession || null); setDailyProgress(restored.dailyProgress || null);
    setScore(restored.score); setStreak(restored.streak); setBestStreak(restored.bestStreak); setAttempted(restored.attempted);
    setMastery(restored.mastery); masteryRef.current = restored.mastery; setLevelsCleared(restored.levelsCleared); setLevelStats(restored.levelStats);
    setStudyStreak(restored.studyStreak); setBestStudyStreak(restored.bestStudyStreak); setLastStudyDate(restored.lastStudyDate);
    studyRef.current = { studyStreak: restored.studyStreak, bestStudyStreak: restored.bestStudyStreak, lastStudyDate: restored.lastStudyDate };
    setPools(restored.pools); poolsRef.current = restored.pools; setBestSpeedScore(restored.bestSpeedScore); setBestSpeedCombo(restored.bestSpeedCombo);
    setConfusions(restored.confusions); confusionsRef.current = restored.confusions; setSolvedStories(restored.solvedStories || []); setSessionLogs(restored.sessionLogs || []);
    latest.current.onReports?.(restored.reports); setSettings(normalizeSettings(restored.settings));
  }

  // "Reset progress": the server's copy is deleted, then everything starts from zero (even when the server could not
  // be reached: onError is told). The content is not touched.
  async function reset({ onError } = {}) {
    progressExtrasRef.current = {}; setActiveSession(null); setDailyProgress(null);
    try { await repo.resetProgress(); } catch (e) { console.error("Could not reset progress:", e); onError?.(e); }
    const zero = resetState();
    setScore(zero.score); setStreak(zero.streak); setBestStreak(zero.bestStreak); setAttempted(zero.attempted);
    setMastery(zero.mastery); masteryRef.current = zero.mastery;
    setLevelsCleared(zero.levelsCleared); setLevelStats(zero.levelStats);
    setStudyStreak(zero.studyStreak); setBestStudyStreak(zero.bestStudyStreak); setLastStudyDate(zero.lastStudyDate); studyRef.current = { studyStreak: zero.studyStreak, bestStudyStreak: zero.bestStudyStreak, lastStudyDate: zero.lastStudyDate };
    setPools(zero.pools); poolsRef.current = zero.pools; setConfusions(zero.confusions); confusionsRef.current = zero.confusions;
    setBestSpeedScore(zero.bestSpeedScore); setBestSpeedCombo(zero.bestSpeedCombo); seenBadgesRef.current = new Set();
    setSolvedStories(zero.solvedStories); setSessionLogs(zero.sessionLogs);
  }

  // Today counts as a study day (once per day; a day missed starts the count again).
  function recordStudyDay() {
    const prev = studyRef.current;
    const next = nextStudyStreakState(prev.lastStudyDate, prev.studyStreak, prev.bestStudyStreak);
    studyRef.current = next;
    setStudyStreak(next.studyStreak);
    setBestStudyStreak(next.bestStudyStreak);
    setLastStudyDate(next.lastStudyDate);
  }

  // Another device (or tab) on this account played: its changes are merged
  // into this one. Checked when the game comes back to the foreground.
  useEffect(() => {
    if (!loaded || !repo.onMerged) return;
    const off = repo.onMerged((merged) => apply(migrateProgressData(merged)));
    let last = 0;
    const check = () => {
      if (!refreshDue(document.visibilityState, last, Date.now())) return;
      last = Date.now();
      repo.refreshProgress?.().catch?.(() => {});
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { off(); document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, [loaded, repo]);

  // A badge earned for the first time shows a small celebration.
  useEffect(() => {
    if (!loaded || !seenBadgesRef.current) return;
    for (const badge of newBadges(gameContent().badges, seenBadgesRef.current, { mastery, bestStreak, levels: gameContent().levels })) {
      seenBadgesRef.current.add(badge.id);
      latest.current.onBadge?.(badge);
    }
  }, [mastery, bestStreak, loaded]);

  const state = { activeSession, settings, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions };
  return {
    ...state, solvedStories, sessionLogs, dailyProgress,
    setActiveSession, setSettings, setSolvedStories, setSessionLogs, setDailyProgress, setLevelsCleared, setLevelStats,
    setStudyStreak, setBestStudyStreak, setLastStudyDate, setBestSpeedScore, setBestSpeedCombo, setScore, setStreak,
    setBestStreak, setAttempted, setMastery, setPools, setConfusions,
    progressExtrasRef, masteryRef, poolsRef, confusionsRef, restoringRef,
    extrasTick, extrasChanged: () => setExtrasTick((n) => n + 1),
    apply, startFrom, restore, reset, recordStudyDay,
    toSave: () => progressToSave(progressExtrasRef.current, state),
  };
}

// Saves the progress after each change (debounced through the save queue; a restored backup is saved as a
// replacement). A change of `alsoOn` also saves (the question reports, which live in the progress object but have
// their own state).
export function useProgressSave({ repo, loaded, progress, debouncedSave, alsoOn }) {
  const p = progress;
  useEffect(() => {
    if (!loaded) return;
    return debouncedSave("progress", () => {
      const replace = p.restoringRef.current;
      p.restoringRef.current = false;
      return repo.saveProgress(p.toSave(), { replace })
        .catch((e) => console.error("Could not save progress:", e));
    });
  }, [loaded, p.activeSession, alsoOn, p.score, p.streak, p.bestStreak, p.attempted, p.mastery, p.levelsCleared, p.levelStats, p.studyStreak, p.bestStudyStreak, p.lastStudyDate, p.pools, p.bestSpeedScore, p.bestSpeedCombo, p.confusions, p.settings, p.extrasTick]);
}
