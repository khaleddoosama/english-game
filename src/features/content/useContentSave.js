// Saving the shared content (admin only), and moving pictures stored inside it to the word-images bucket. The steps
// with no state are in contentSyncRules.js. Docs: docs/modules/content/content-sync.md.
import { useEffect, useRef } from "react";
import { gameContent, setGameContent } from "./gameContent";
import { storeEmbeddedImages } from "../../lib/images";
import { contentPayload, contentSaveWarning, embeddedPictures, withStoredPictures } from "./contentSyncRules";

// loaded, isAdmin, repo     nothing happens before the load, or for a player
// lists                     what useContentLists returns (the five lists, contentNoteRef, setCustomWords)
// dataVersion, setDataVersion   a bump schedules a save; the picture move bumps it
// saves                     { debouncedSave, pendingSavesRef, contentWritesRef }: the shell's save queue, shared with progress
// renames                   { takePendingRenames, returnPendingRenames } from the content admin
// setStorageWarning         shows why a save failed
export function useContentSave({ loaded, isAdmin, repo, lists, dataVersion, setDataVersion, saves, renames, setStorageWarning }) {
  const { customWords, customGrammar, customChallenges, customCombos, customStories, contentNoteRef, setCustomWords } = lists;
  const { debouncedSave, pendingSavesRef, contentWritesRef } = saves;

  // Content edits are single clicks (save, delete, import), not typing, so the wait is short: it only folds together
  // changes made in one go. Saves run one after another.
  const contentSavingRef = useRef(Promise.resolve());
  useEffect(() => {
    if (!loaded || !isAdmin) return;
    contentWritesRef.current++;
    let counted = true;
    const settle = () => { if (counted) { counted = false; contentWritesRef.current--; } };
    const cancel = debouncedSave("content", () => {
      const content = contentPayload({ note: contentNoteRef.current, combos: customCombos, stories: customStories, words: customWords, grammar: customGrammar, challenges: customChallenges }, gameContent().levelOrder);
      const pending = renames.takePendingRenames();
      return contentSavingRef.current = contentSavingRef.current.then(() => repo.saveContent(content, { renames: pending })).catch((e) => {
        console.error("Could not save content:", e);
        renames.returnPendingRenames(pending);
        setStorageWarning(contentSaveWarning(e));
      }).finally(settle);
    }, 150);
    return () => { cancel(); if (pendingSavesRef.current.content === undefined) return; settle(); };
  }, [loaded, customCombos, customStories, customWords, customGrammar, customChallenges, dataVersion]);

  // A picture that came inside the content (an import, or a copy made in local mode) moves to the word-images bucket:
  // as a link it isn't sent to every player with every content load. Only the values still unchanged are swapped, so
  // an edit made meanwhile wins; one that can't be stored now is tried again with the next content change.
  const movingPicturesRef = useRef(false);
  const latestContentRef = useRef(null);
  latestContentRef.current = { grammar: customGrammar, challenges: customChallenges };
  useEffect(() => {
    if (!loaded || !isAdmin || repo.mode !== "supabase" || movingPicturesRef.current) return;
    const embedded = embeddedPictures(customWords);
    if (!embedded.length) return;
    movingPicturesRef.current = true;
    storeEmbeddedImages(embedded).then((stored) => {
      if (!stored.size) return;
      setCustomWords((current) => {
        const next = withStoredPictures(current, stored);
        setGameContent(next, latestContentRef.current.grammar, latestContentRef.current.challenges, gameContent().levelOrder);
        return next;
      });
      setDataVersion((value) => value + 1);
    }).finally(() => { movingPicturesRef.current = false; });
  }, [loaded, customWords]);
}
