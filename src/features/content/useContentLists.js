// The shared content the game holds: the five lists (words, grammar rules, challenges, combos, stories) and the
// content note. Loading a saved copy rebuilds the game's own copy (mergeCustomData). Docs:
// docs/modules/content/content-sync.md.
import { useRef, useState } from "react";
import { V2 } from "../../engine/v2";
import { LEVEL_ORDER, mergeCustomData } from "../../engine/data";

export function useContentLists() {
  const [customWords, setCustomWords] = useState([]);
  const [customGrammar, setCustomGrammar] = useState([]);
  const [customChallenges, setCustomChallenges] = useState([]);
  const [customCombos, setCustomCombos] = useState([]);
  const [customStories, setCustomStories] = useState([]);
  const contentNoteRef = useRef("");

  function setContent(c) { setCustomWords(c.words); setCustomGrammar(c.grammar); setCustomChallenges(c.challenges); setCustomCombos(c.combos); setCustomStories(c.stories); }

  // A saved copy (or none): removed fields are dropped, the lists and the note are set, and the game's own copy is
  // rebuilt with the saved level order (else the current one). Returns whether there was a saved copy. Runs before
  // the progress is applied, so levels and badges exist by then.
  function applySavedContent(custom) {
    if (!custom) return false;
    custom = V2.withoutRemovedFields(custom);
    setCustomCombos(custom.combos || []); setCustomStories(custom.stories || []); contentNoteRef.current = custom.note || "";
    setCustomWords(custom.words || []);
    setCustomGrammar(custom.grammar || []);
    setCustomChallenges(Array.isArray(custom.challenges) ? custom.challenges : []);
    const levelOrder = custom.levelOrder || LEVEL_ORDER;
    mergeCustomData(custom.words || [], custom.grammar || [], custom.challenges || [], levelOrder);
    return true;
  }

  return {
    customWords, setCustomWords, customGrammar, setCustomGrammar, customChallenges, setCustomChallenges,
    customCombos, setCustomCombos, customStories, setCustomStories, contentNoteRef, setContent, applySavedContent,
  };
}
