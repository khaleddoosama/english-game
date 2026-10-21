// Question reports: the list the player and the admin see, and what can be done with a report. The pure rules are
// in reportRules.js. The list also lives in progressExtrasRef.current.reports, which is what is saved with the
// progress; every change writes both, the ref first (as the shell always did). Docs: docs/modules/practice/question-reports.md.
import { useMemo, useState } from "react";
import { locateReportSource, reviewReportedQuestion } from "../../lib/aiPrompts";
import { getWordPools } from "../../engine/questions";
import { V2 } from "../../engine/v2";
import { buildReport, followRenames, mapReport, quarantineOf, withReport, withoutReport } from "./reportRules";

// progressExtrasRef  the shell's ref of everything saved with the progress except the big parts
// profile            who is signed in (the reporter), null in local mode
// liveContent        () => the content as the game holds it now (the AI review looks the question up in it)
// markSentencesSeen  a reported question counts as read: its sentences are not asked again soon
// touchSession       makes the open round redraw (a resolved report changes what the round may show)
// poolsRef, setPools, triggerGeneration   the question pools, used only to retire a reported variant
export function useQuestionReports({ gameContent, progressExtrasRef, profile, liveContent, markSentencesSeen, touchSession, poolsRef, setPools, triggerGeneration }) {
  const [reports, setReports] = useState([]);
  // Reported (word, mode) pairs are held back from the adaptive question choosers until the report is resolved or retired.
  const quarantine = useMemo(() => quarantineOf(reports), [reports]);
  const save = (next) => { progressExtrasRef.current = { ...progressExtrasRef.current, reports: next }; setReports(next); };

  function report(q, session, reason, learnerAnswer, details, prior = null) {
    markSentencesSeen(q);
    const made = buildReport(q, session, reason, learnerAnswer, details, prior, profile);
    save(withReport(progressExtrasRef.current.reports, made));
    return made;
  }
  // AI triage for one report. Stores the review on the report (so Admin sees the verdict and any drafted fix)
  // and returns it for the learner's view.
  async function review(target, options = {}) {
    const result = await reviewReportedQuestion(target, locateReportSource(liveContent(), target), options);
    save(mapReport(progressExtrasRef.current.reports, target, (item) => ({ ...item, aiReview: result })));
    return result;
  }
  function remove(target) { save(withoutReport(progressExtrasRef.current.reports, target)); }
  function resolve(target) {
    save(mapReport(progressExtrasRef.current.reports, target, (item) => ({ ...item, resolvedAt: Date.now() })));
    touchSession();
  }
  function reopen(target) { save(mapReport(progressExtrasRef.current.reports, target, (item) => ({ ...item, resolvedAt: null }))); }
  // Takes the reported variant out of play for good (and has a new one made), then resolves the report.
  // A report with no variant, or about a word that is gone, is only resolved.
  function retire(target) {
    const wordObj = V2.findWord(gameContent().words, target.targetWords?.[0]);
    if (!wordObj || !target.poolType || !target.poolItemId) { resolve(target); return; }
    const snapshot = poolsRef.current, wordPools = getWordPools(snapshot, wordObj);
    const items = wordPools[target.poolType].map((item) => (item.id === target.poolItemId ? { ...item, flagged: true, lockedUntil: Date.now() + 100 * 365 * 86400000 } : item));
    const nextWordPools = { ...wordPools, [target.poolType]: items }, nextPools = { ...snapshot, [wordObj.word]: nextWordPools };
    poolsRef.current = nextPools; setPools(nextPools); triggerGeneration([{ word: wordObj.word, poolType: target.poolType }], nextPools); resolve(target);
  }
  // Other ways the list changes, called by the shell: progress loaded or restored (the list is replaced; the ref is
  // set by the caller with the rest of the progress), and a word renamed (its reports follow it).
  const load = (list) => setReports(Array.isArray(list) ? list : []);
  const followRename = (wmap) => save(followRenames(progressExtrasRef.current.reports, wmap));

  return { reports, quarantine, report, review, remove, resolve, reopen, retire, load, followRename };
}
