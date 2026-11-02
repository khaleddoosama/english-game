// The shared cases of the word contract (tests/fixtures/word-contract-cases.json) turned into words, for the
// JavaScript test (word-contract.test.js) and the SQL one (integration/word-contract-sql.test.js). A case starts from
// base, sets `set`, removes `unset` and makes the texts in `repeat` that many characters long. Made-up words only.
import { readFileSync } from "node:fs";

const file = JSON.parse(readFileSync(new URL("./fixtures/word-contract-cases.json", import.meta.url), "utf8"));

export const WORD_CONTRACT_CASES = file.cases.map((c) => {
  if (c.replace) return { name: c.name, word: c.replace[0], errors: c.errors };
  const word = structuredClone(file.base);
  for (const key of c.unset || []) delete word[key];
  for (const [key, value] of Object.entries(c.set || {})) word[key] = structuredClone(value);
  for (const [key, n] of Object.entries(c.repeat || {})) word[key] = "x".repeat(n);
  return { name: c.name, word, errors: c.errors };
});
