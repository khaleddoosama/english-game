// A word the player made (typed in, or written by the AI helper) also goes into
// their library, so it can be put in views and shared. Best effort: the game
// already has the word, so a refusal is not an error for the player.
export async function keepInLibrary(library, card) {
  if (library.status !== "ready") return;
  try {
    await library.api.createWord(card);
    await library.refreshIds();
  } catch { /* the word is in the game either way */ }
}
