// The rules both sides of the library agree on (migrations 0026-0030): the
// database enforces them, the local mirror copies them, and the screens use
// them to say no before asking. One place, so the two never drift.
export const MAX_VIEWS = 200;
export const MAX_DEPTH = 4;
export const MAX_PER_CALL = 200;
export const MAX_SHARE_USERS = 20;
export const MAX_SHARES_WAITING = 50;
export const MAX_LIBRARY = 5000;
export const MAX_LINKS = 50;
export const LINK_DAYS = 30;
export const MAX_CATALOG = 20;
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 300;
export const MAX_NAME = 60;
export const NAME_ERROR = 'A view name is 1 to 60 characters and has no "::" in it.';

export const cleanViewName = (s) => String(s ?? "").trim();
export const validViewName = (s) => { const n = cleanViewName(s); return n.length >= 1 && n.length <= MAX_NAME && !n.includes("::"); };

// The messages the server raises, with the SQLSTATE it raises them under.
export const MSG = Object.freeze({
  noView: ["That view does not exist.", "P0002"],
  nameTaken: (n) => [`There is already a view called "${n}" here.`, "23505"],
  tooManyViews: [`You have ${MAX_VIEWS} views, the most there can be.`, "55000"],
  tooDeep: [`Views can be ${MAX_DEPTH} levels deep, no more.`, "55000"],
  intoItself: ["A view cannot go inside itself.", "22023"],
  badName: [NAME_ERROR, "22023"],
  tooManyWords: [`Add up to ${MAX_PER_CALL} words at a time.`, "22023"],
  tooManyRules: [`Add up to ${MAX_PER_CALL} rules at a time.`, "22023"],
  libraryFull: [`A library holds up to ${MAX_LIBRARY} words.`, "55000"],
  notInLibrary: ["That word is not in your library.", "P0002"],
  patchShape: ["A patch is an object.", "22023"],
  patchSize: ["That change is too big.", "22023"],
  badWord: ["A word is 1 to 120 characters.", "22023"],
  shareTooMany: [`Share with up to ${MAX_SHARE_USERS} friends at a time.`, "22023"],
  shareNotFriend: ["You can share only with your friends.", "42501"],
  shareFriendFull: ["A friend has too many shares waiting. Try again later.", "55000"],
  shareGone: ["That share is no longer waiting.", "P0002"],
  shareRemoved: ["The sender removed that view.", "P0002"],
  shareUnfriended: ["You are no longer friends.", "42501"],
  linkGone: ["This link no longer works.", "P0002"],
  linkOwn: ["This is your own view.", "22023"],
  linkTooMany: ["You have 50 links open. Take some back first.", "55000"],
  catalogTitle: [`Give it a title of up to ${MAX_TITLE} characters.`, "22023"],
  catalogDescription: [`The description is up to ${MAX_DESCRIPTION} characters.`, "22023"],
  catalogTooMany: [`You have ${MAX_CATALOG} views in the catalog. Take some down first.`, "55000"],
  catalogGone: ["That view is no longer in the catalog.", "P0002"],
  shareNoRoom: (n) => [`You do not have room for ${n} more views (the most is ${MAX_VIEWS}).`, "55000"],
});

// A card in the game's shape ({ word, type, partsOfSpeech, category, meaning,
// situation, gap, hints … }) as the arguments of sense_create: the columns the
// database keeps apart, and everything else as the card's content.
export function senseFromCard(card, source = "user") {
  const { word, type, partsOfSpeech, category, meaning, level, ...content } = card || {}; // eslint-disable-line no-unused-vars
  const clean = Object.fromEntries(Object.entries(content).filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && v !== ""));
  return { word: String(word || "").trim(), type: type || "vocab", pos: Array.isArray(partsOfSpeech) ? partsOfSpeech : [], category: category || null, meaning: String(meaning || "").trim(), content: clean, source: card?._aiAdded ? "ai" : source };
}
