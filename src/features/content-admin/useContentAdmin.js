// Content admin: the admin's changes to the shared course (rename a word, edit its fields, merge categories, remove
// empty levels, the levels editor) and the progress that follows a rename. The pure rules are in
// contentAdminRules.js; this hook applies them to the shell's state, as the shell always did: set the lists, rebuild
// the game's content (setGameContent), move progress keys, then bump dataVersion (which schedules the content save).
// Docs: docs/modules/admin/content-admin.md.
import { useRef } from "react";
import { renameProblem } from "../../engine/wordIdentity";
import {
  editedLevels, hasRenames, levelIdMap, levelListWithout, mergedCategories, movedKeys, pendingOf,
  renamedClearedLevels, renamedConfusions, renamedWord, withWordFields, withoutEmptyLevels,
} from "./contentAdminRules";

// isAdmin     only the admin's renames are queued for the server (content_save_v2 moves every player's progress)
// content     the custom lists: { customWords, customGrammar, customChallenges, customCombos, customStories }
// set         their setters, plus setDataVersion and setToast (a refused rename says why)
// progress    { masteryRef, setMastery, poolsRef, setPools, confusionsRef, setConfusions, setLevelStats, setLevelsCleared }
// followReportRename   the question-reports module's followRename (reports follow a renamed word)
export function useContentAdmin({ isAdmin, gameContent, setGameContent, content, set, progress, followReportRename }) {
  const { customWords, customGrammar, customChallenges, customCombos, customStories } = content;
  const { setCustomWords, setCustomGrammar, setCustomChallenges, setCustomCombos, setCustomStories, setDataVersion, setToast } = set;
  // Renames waiting to go to the server with the next content save, where they move every player's progress.
  const pendingRenamesRef = useRef([]);
  const lists = () => ({ words: customWords, grammar: customGrammar, challenges: customChallenges, combos: customCombos, stories: customStories });
  const setLists = (next) => { setCustomWords(next.words); setCustomGrammar(next.grammar); setCustomChallenges(next.challenges); setCustomCombos(next.combos); setCustomStories(next.stories); };

  // A rename moves progress, which is keyed by names: mastery, question pools, confusion pairs and report targets for
  // words; level stats and cleared levels for categories. Also called by an import that renames (v3, same id).
  function migrateRenamedProgress(renames) {
    if (!hasRenames(renames)) return;
    if (isAdmin) pendingRenamesRef.current.push(...pendingOf(renames));
    const wmap = new Map(renames.words.map((r) => [r.from, r.to]));
    if (wmap.size) {
      const { masteryRef, setMastery, poolsRef, setPools, confusionsRef, setConfusions } = progress;
      const m = movedKeys(masteryRef.current, wmap); masteryRef.current = m; setMastery(m);
      const p = movedKeys(poolsRef.current, wmap); poolsRef.current = p; setPools(p);
      const c = renamedConfusions(confusionsRef.current, wmap); confusionsRef.current = c; setConfusions(c);
      followReportRename(wmap);
    }
    if (renames.categories.length) {
      const cmap = levelIdMap(renames.categories);
      progress.setLevelStats((prev) => movedKeys(prev, cmap));
      progress.setLevelsCleared((prev) => renamedClearedLevels(prev, cmap));
    }
  }
  // Refused, with a toast, when another word already has the new name.
  function renameWord(from, nextWord) {
    const problem = renameProblem(customWords, from, nextWord.word);
    if (problem) { setToast({ text: problem }); return; }
    const { linked, renames } = renamedWord(lists(), from, nextWord);
    setGameContent(linked.words, customGrammar, linked.challenges, gameContent().levelOrder);
    setCustomWords(linked.words); setCustomCombos(linked.combos); setCustomStories(linked.stories); setCustomChallenges(linked.challenges);
    migrateRenamedProgress(renames); setDataVersion((v) => v + 1);
  }
  function updateWordFields(wordName, patch) {
    const next = withWordFields(customWords, wordName, patch);
    setGameContent(next, customGrammar, customChallenges, gameContent().levelOrder);
    setCustomWords(next);
    setDataVersion((v) => v + 1);
  }
  function mergeCategories(canonical, duplicates) {
    const merged = mergedCategories(lists(), gameContent().levelOrder, canonical, duplicates);
    if (!merged) return;
    setLists(merged);
    setGameContent(merged.words, merged.grammar, merged.challenges, merged.order);
    migrateRenamedProgress(merged.renames); setDataVersion((v) => v + 1);
  }
  function removeEmptyLevels() {
    const { order, removed } = withoutEmptyLevels(lists(), gameContent().levelOrder);
    if (removed) { setGameContent(customWords, customGrammar, customChallenges, order); setDataVersion((v) => v + 1); }
    return removed;
  }
  // field "levels": the levels editor's list (see editedLevels); any other field: that list replaced.
  function updateAdminContent(field, nextList) {
    if (field === "levels") {
      const edited = editedLevels(lists(), gameContent().levelOrder, nextList);
      setLists(edited);
      setGameContent(edited.words, edited.grammar, edited.challenges, edited.order);
      if (edited.renames) migrateRenamedProgress(edited.renames);
      setDataVersion((v) => v + 1); return;
    }
    const nextWords = field === "words" ? nextList : customWords;
    const nextGrammar = field === "grammar" ? nextList : customGrammar;
    const nextChallenges = field === "challenges" ? nextList : customChallenges;
    if (field === "words") setCustomWords(nextList);
    if (field === "grammar") setCustomGrammar(nextList);
    if (field === "challenges") setCustomChallenges(nextList);
    if (field === "combos") setCustomCombos(nextList);
    if (field === "stories") setCustomStories(nextList);
    setGameContent(nextWords, nextGrammar, nextChallenges, gameContent().levelOrder);
    setDataVersion((v) => v + 1);
  }
  // Deleting a category deletes its items.
  const deleteLevelCategory = (level) => updateAdminContent("levels", levelListWithout(gameContent().levelOrder, level.title));
  // The content save takes the waiting renames; a save that failed puts them back in front, for the next one.
  const takePendingRenames = () => pendingRenamesRef.current.splice(0);
  const returnPendingRenames = (renames) => { pendingRenamesRef.current.unshift(...renames); };

  return { renameWord, updateWordFields, migrateRenamedProgress, mergeCategories, removeEmptyLevels, updateAdminContent, deleteLevelCategory, takePendingRenames, returnPendingRenames };
}
