// A round from one of my views: which words and rules it asks about.
import { scopeFromContents } from "./scope";

// The scope ({ words, rules } by the game's keys) of a view, with the views
// inside it unless deep is false. Rejects with the API's error.
export async function scopeOfView(library, viewId, deep = true) {
  const rows = await library.api.contents(viewId, deep);
  return scopeFromContents(rows, { resolveKey: library.ids.keyOfSense, resolveRule: library.ids.keyOfRule });
}
