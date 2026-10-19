// The game's copy of the content (engine/catalog.js) is reached through this module: gameContent() returns the
// current copy ({ words, grammar, challenges, levelOrder, levels, badges }), setGameContent(words, grammar,
// challenges, levelOrder) rebuilds it. The shell passes them to the features that need them. Docs:
// docs/modules/content/content-catalog.md.
export { currentCatalog as gameContent, mergeCustomData as setGameContent } from "../../engine/data";
