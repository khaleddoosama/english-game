// What every part of the local library shares: whose library this is, where
// it is stored, and the few questions it asks the rest of the app (is this
// word real, are these two friends, what is someone called).
import { LibraryError } from "../libraryErrors";
import { emptyDb } from "./localViews";

// storage: anything with getItem/setItem (tests pass a Map-backed fake).
// me(): the current player's id. canSee(key): whether that word exists and may
// be added (the dictionary lives elsewhere in local mode).
export function createLocalContext({ storage, me, canSee = () => true, areFriends = () => false, nameOf = () => "player", isAdmin = () => false, now = () => Date.now() }) {
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key) || "null") ?? fallback(); } catch { return fallback(); } };
  const write = (key, value) => storage.setItem(key, JSON.stringify(value));
  return {
    me, canSee, areFriends, nameOf, isAdmin, now, read, write,
    load: (user = me()) => read(`library1:${user}`, emptyDb),
    save: (db, user = me()) => write(`library1:${user}`, db),
    loadShares: () => read("library1:shares", () => []),
    saveShares: (list) => write("library1:shares", list),
    // [message, code] pairs come from libraryRules.MSG
    fail: ([message, code]) => { throw new LibraryError(message, code); },
  };
}
