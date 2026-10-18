// Made-up words for the tests of rounds from a view. Nothing here comes from a
// real player or the real course, and no meaning contains its own word, so a
// question is never rejected for giving the answer away unless a test wants it.

// A repeatable random source. Small seeds are spread out first, because the
// first draws of a plain generator started at 1, 2, 3 … are all nearly 0.
export const seeded = (seed = 7) => {
  let x = (Math.imul(seed, 2654435761) >>> 0) % 2147483647 || 1;
  const next = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  next(); next();
  return next;
};

export const word = (name, extra = {}) => {
  const tag = name.toLowerCase().replace(/\D+/g, "") || name.toLowerCase();
  return {
    word: name, type: "vocab", category: "Lesson 1",
    meaning: `definition ${tag}`, situation: `Someone talked about ${name}.`, gap: `Case ${tag}: she felt ______.`,
    ...extra,
  };
};

// Word0 … Word{n-1}, each with its own meaning ("definition 0" …).
export const dictionary = (n = 20, extra = () => ({})) => Array.from({ length: n }, (_, i) => word(`Word${i}`, extra(i)));

export const scopeOf = (words = [], rules = []) => ({ words: new Set(words), rules: new Set(rules) });

// What a player's record looks like once a word has been seen once.
export const introduced = (names) => Object.fromEntries(names.map((n) => [n, { introducedAt: 1, correct: 1, total: 1, modes: { reverse: { correct: 1, total: 1 } } }]));
