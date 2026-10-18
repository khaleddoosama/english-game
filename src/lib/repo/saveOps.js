import { stableJson } from "../stableJson";

// Operation ids for progress saves (migration 0042). Pure helpers: the repo keeps the state.
//
// One logical save has one id, for as long as the device has no answer to it. The database applies
// an id once; sending it again returns { duplicate: true, revs } and changes nothing.

export const newOpId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  // Very old browsers: 122 random bits are not needed, only an id nobody else makes.
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16); }));

// A database without migration 0042 does not know the argument: PostgREST says PGRST202,
// PostgreSQL itself 42883 ("function does not exist"). Anything else is a real failure.
export const lacksOpSupport = (error) => !!error && (error.code === "PGRST202" || error.code === "42883");

// What to remember about a save that has been sent but not answered.
export const inflightOf = (op, args) => ({ op, args });

// A snapshot's base after its unanswered save turned out to be on the server: the sections it
// wrote are the new base, at the revisions the server recorded for it.
export function baseAfter(base, args, revs) {
  const sections = { ...(base?.sections || {}) };
  for (const [name, value] of Object.entries(args?.p_sections || {})) sections[name] = stableJson(value);
  return { revs: { ...(base?.revs || {}), ...(revs || {}) }, sections };
}

// The database answered with an error of its own (a SQLSTATE or a PostgREST code): the call was rolled
// back, so the save was not applied. An error with no code ("Failed to fetch", a gateway page) says
// nothing about whether the database got it.
export const wasNotApplied = (error) => !!error && /^([0-9A-Z]{5}|PGRST\d+)$/.test(String(error.code ?? ""));
