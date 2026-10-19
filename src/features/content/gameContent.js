// The game's copy of the content (built by buildCatalog, engine/catalog.js) is kept here and nowhere else:
// gameContent() returns the current copy ({ words, grammar, challenges, levelOrder, levels, badges }),
// setGameContent(words, grammar, challenges, levelOrder) replaces it with a new one built from the lists. The shell
// passes both to the features that need them. Docs: docs/modules/content/content-catalog.md.
import { buildCatalog } from "../../engine/catalog";
import { BUILTIN_CHALLENGES, BUILTIN_GRAMMAR, BUILTIN_WORDS, INCLUDE_BUILTIN_IN_PLAY } from "../../engine/data";
import { checkImageLinks } from "../media/media";

let current = buildCatalog(BUILTIN_WORDS, BUILTIN_GRAMMAR, BUILTIN_CHALLENGES, []);

export const gameContent = () => current;

// Called once on load (with the saved content) and after every change: an admin edit, an import, a word from Ask AI.
// Every word's picture link is checked in the background, so questions know which pictures load.
export function setGameContent(customWords, customGrammar, customChallenges, levelOrder) {
  const baseWords = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_WORDS : [];
  const baseGrammar = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_GRAMMAR : [];
  const baseChallenges = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_CHALLENGES : [];
  current = buildCatalog([...baseWords, ...customWords], [...baseGrammar, ...customGrammar], [...baseChallenges, ...(Array.isArray(customChallenges) ? customChallenges : [])], levelOrder);
  checkImageLinks(current.words);
}
