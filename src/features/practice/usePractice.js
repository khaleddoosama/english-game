import { V2 } from "../../engine/v2";
import { SPEED_QUEUE_SIZE, SPEED_SECONDS } from "../../engine/questions";
import { MIN_MASTERED_FOR_SPEED, courseLevelStart, lessonStart, moreNewWordsText, newWordsFor, practiceExtra, speedQueue, speedSession, usedUpGapWords } from "./practiceRules";

// Starting rounds: a lesson or one of its groups, a course level, a list of Home items, a personal view, a story,
// and the Speed Round. Each builds a session and opens it (`onOpen(session)` puts it on screen).
// progress        useProgress's result (the open session, settings, round log, records, pools, read sentences)
// gameContent()   the game's copy of the content; liveContent() the same with the stories, combos and note
// quarantine      reported word and mode pairs, kept out of new rounds
// home            { limited, levels }: a player who sees only their library gets the lessons cut down to it
// views           { ready, scopeOf(viewId, deep), isEmpty(scope) } from the library
// itemsScope(items) the words and rules of a list of Home items
// imageOk(url)    a picture may be shown
// onLesson(index) remembers the lesson being played (null for other rounds)
// onToast, triggerGeneration (new gap sentences in the background), onOpen
// Docs: docs/modules/practice/starting-rounds.md.
export function usePractice({ progress, gameContent, liveContent, quarantine, home, views, itemsScope, imageOk, onLesson, onToast, triggerGeneration, onOpen }) {
  const p = progress;

  function launchSession(session) { p.setActiveSession(session); onOpen(session); }

  function startPractice(title, category, narrow, inRound) {
    const base = p.settings.newWordsPerRound;
    const newWords = newWordsFor(base, p.sessionLogs, title);
    const seen = p.progressExtrasRef.current.seenSentences || {};
    const extraQuestion = (wordObj, stage, rng) => practiceExtra(gameContent(), wordObj, stage, { pools: p.poolsRef.current, seen: p.progressExtrasRef.current.seenSentences || {}, imageOk }, rng);
    const session = V2.practice(liveContent(), p.masteryRef.current, category, Math.random, quarantine, { questionsPerRound: p.settings.questionsPerRound, newWordsPerRound: newWords, pools: p.poolsRef.current, extraQuestion, confusions: p.confusionsRef.current, seen, ...narrow });
    const usedUp = usedUpGapWords(gameContent().words, inRound, p.masteryRef.current, p.poolsRef.current, seen);
    if (usedUp.length) triggerGeneration(usedUp.map((w) => ({ word: w.word, poolType: "gap" })), p.poolsRef.current);
    const message = moreNewWordsText(base, newWords, session.introductions.length);
    if (message) onToast({ text: message });
    launchSession(session);
  }

  function startItemsPractice(title, items) {
    const scope = itemsScope(items);
    onLesson(null);
    startPractice(title, null, { title, scope }, (w) => scope.words.has(w.word));
  }

  // group (optional): one subCategory or unit of the lesson, from levelGroups().
  function startLevel(index, group = null) {
    const level = gameContent().levels[index]; if (!level) return;
    const start = lessonStart(level, group);
    if (home.limited) return startItemsPractice(start.title, group ? group.items : (home.levels.find((l) => l.id === level.id)?.items || []));
    onLesson(index);
    startPractice(start.title, start.category, start.narrow, start.inRound);
  }

  function startCourseLevel(level, part = null) {
    onLesson(null);
    const start = courseLevelStart(level, part);
    startPractice(start.title, null, start.narrow, start.inRound);
  }

  // A round from one of my views (and, with deep, the views inside it).
  async function startViewPractice(viewId, deep = true, name = "My view") {
    if (!views.ready) return;
    try {
      const scope = await views.scopeOf(viewId, deep);
      if (views.isEmpty(scope)) { onToast({ text: "This view is empty. Add some words first." }); return; }
      onLesson(null);
      startPractice(name, null, { title: name, scope }, (w) => scope.words.has(w.word));
    } catch (e) { onToast({ text: e.message }); }
  }

  function launchStory(story) {
    try { launchSession(V2.storySession(story, gameContent().words, p.masteryRef.current)); } catch (e) { onToast({ text: e.message }); }
  }

  // The Speed Round: a timed review of mastered words (`masteredWords` from the shell).
  function startSpeedRound(masteredWords) {
    if (masteredWords.length < MIN_MASTERED_FOR_SPEED) return;
    const queue = speedQueue(gameContent(), masteredWords, SPEED_QUEUE_SIZE);
    if (!queue.length) { onToast({ text: "No short questions with safe options are available." }); return; }
    const seconds = p.settings.speedSeconds || SPEED_SECONDS;
    launchSession(speedSession(queue, seconds, Date.now()));
  }

  return { launchSession, startLevel, startCourseLevel, startItemsPractice, startViewPractice, launchStory, startSpeedRound };
}
