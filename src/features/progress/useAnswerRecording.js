import { useRef } from "react";
import { V2 } from "../../engine/v2";
import { speedStats } from "../../engine/questions";
import { POINTS_PER_ANSWER, STAR_ACCURACY, afterRoundLog, answerKey, countsAnswer, dayAfterAnswer, goalJustReached, isWholeRound, lessonRound, marksSentences, nextStreak, roundLogEntry, withCompleted, withConfusion, withIntroduced, withLessonCleared, withLessonStat, withSeenSentences, withSolvedStory, withVariantAnswer, withWordPoolAnswer, wrongWordChoices } from "./recordRules";

// What answers and finished rounds record in the player's progress (from useProgress). V2 keeps mastery evidence
// session-based so repeated questions cannot inflate a word's stage; the rest (the day's count, streaks, points,
// pools, confusions, read sentences) is recorded once, at answer time, so partly played or resumed rounds count too.
// progress      useProgress's result
// gameContent() the game's copy of the content
// onToast       shows a short message ({ text })
// generation    { triggerGeneration, triggerVariantGeneration, keepGrammarFresh } from useAiGeneration (new sentences
//               when a pool runs out)
// Returns { markSentencesSeen(q), recordSessionResult(q, result, session), trackConfusion(target, selected),
// introduceWords(words), completeSession(session) -> what the screen shows next }.
// Docs: docs/modules/progress/answer-recording.md.
export function useAnswerRecording({ progress, gameContent, onToast, generation }) {
  const p = progress;
  const recordedSessionAnswersRef = useRef(new Set());

  function markSentencesSeen(q) {
    const read = V2.questionSentences(q);
    if (!read.length) return;
    p.progressExtrasRef.current = { ...p.progressExtrasRef.current, seenSentences: withSeenSentences(p.progressExtrasRef.current.seenSentences, read, Date.now()) };
  }

  function trackConfusion(targetWord, selectedValue) {
    const next = withConfusion(p.confusionsRef.current, gameContent(), targetWord, selectedValue, Date.now());
    if (!next) return;
    p.confusionsRef.current = next;
    p.setConfusions(next);
  }

  function recordSessionResult(q, result, session) {
    if (marksSentences(q, result, session)) markSentencesSeen(q);
    if (!countsAnswer(q, result)) return;
    const key = answerKey(session);
    if (recordedSessionAnswersRef.current.has(key)) return;
    recordedSessionAnswersRef.current.add(key);
    const independentCorrect = !!result.correct && !result.assisted;
    const goal = p.settings.dailyGoal;
    const nextDay = dayAfterAnswer(p.progressExtrasRef.current.dailyProgress, result.correct);
    const reached = goalJustReached(p.progressExtrasRef.current.dailyProgress, nextDay, goal);
    p.progressExtrasRef.current = { ...p.progressExtrasRef.current, dailyProgress: nextDay };
    p.setDailyProgress(nextDay);
    if (reached) onToast({ text: `Daily goal reached: ${goal} questions today. Anything more is a bonus!` });
    p.setAttempted((n) => n + 1);
    p.setStreak((current) => {
      const next = nextStreak(current, independentCorrect);
      p.setBestStreak((best) => Math.max(best, next));
      return next;
    });
    if (independentCorrect) p.setScore((value) => value + POINTS_PER_ANSWER);

    if (q.poolType === "combo" || q.poolType === "grammar") {
      const key = q.progressKey;
      if (key) {
        const out = withVariantAnswer(p.poolsRef.current, key, q.poolItemId, independentCorrect, Date.now());
        p.poolsRef.current = out.pools; p.setPools(out.pools);
        if (!out.stillFresh) generation.triggerVariantGeneration(q.poolType, key);
      }
    } else if (q.poolType && q.poolItemId && q.targets?.length) {
      const wordObj = V2.findWord(gameContent().words, q.targets[0]);
      if (wordObj) {
        const out = withWordPoolAnswer(p.poolsRef.current, wordObj, q.poolType, q.poolItemId, independentCorrect, Date.now());
        p.poolsRef.current = out.pools; p.setPools(out.pools);
        // Keep one unseen variant ready, so the next time this word comes up it has a different sentence.
        if (out.generate) generation.triggerGeneration([{ word: wordObj.word, poolType: q.poolType }], out.pools);
      }
    }

    // Any grammar question, with or without written variants of its own.
    if (String(q.progressKey || "").startsWith("grammar:")) generation.keepGrammarFresh(q.progressKey.slice(8));

    wrongWordChoices(q, result, gameContent().words).forEach(([target, chosen]) => trackConfusion(target, chosen));
  }

  // New words shown on their learning cards.
  function introduceWords(words) {
    const next = withIntroduced(p.masteryRef.current, words, Date.now());
    p.masteryRef.current = next; p.setMastery(next); p.recordStudyDay();
  }

  // A round ends (or is left). Records it once. Returns null (already recorded), { speed: stats } (a Speed Round:
  // show its results), or {} (stay). A Final Case round saved before it was removed (2026-10-20) ends like any other.
  function completeSession(session) {
    const done = p.progressExtrasRef.current.completedSessions || [];
    if (session.kind === "speed") {
      if (done.includes(session.id)) return null;
      p.progressExtrasRef.current = { ...p.progressExtrasRef.current, completedSessions: withCompleted(done, session.id) };
      const st = speedStats(session.answers);
      p.setBestSpeedScore((b) => Math.max(b, st.points)); p.setBestSpeedCombo((b) => Math.max(b, st.bestCombo));
      if (st.answered) p.recordStudyDay();
      p.setActiveSession(null);
      return { speed: st };
    }
    if (session.completed || done.includes(session.id)) return null;
    p.progressExtrasRef.current = { ...p.progressExtrasRef.current, completedSessions: withCompleted(done, session.id) };
    if (isWholeRound(session)) {
      const log = afterRoundLog(p.progressExtrasRef.current, roundLogEntry(session, Date.now()));
      p.progressExtrasRef.current = { ...p.progressExtrasRef.current, ...log }; p.setSessionLogs(log.sessionLogs);
    }
    const next = V2.sessionEvidence(p.masteryRef.current, session);
    p.masteryRef.current = next; p.setMastery(next); p.recordStudyDay();
    const lesson = lessonRound(session, gameContent().levels);
    if (lesson) {
      p.setLevelStats((prev) => withLessonStat(prev, lesson.levelId, lesson.accuracy));
      if (lesson.accuracy >= STAR_ACCURACY) p.setLevelsCleared((prev) => withLessonCleared(prev, lesson.levelId));
    }
    const solved = withSolvedStory(p.progressExtrasRef.current.solvedStories, session);
    if (solved) { p.progressExtrasRef.current = { ...p.progressExtrasRef.current, solvedStories: solved }; p.setSolvedStories(solved); }
    p.setActiveSession({ ...session, completed: true });
    return {};
  }

  return { markSentencesSeen, recordSessionResult, trackConfusion, introduceWords, completeSession };
}
