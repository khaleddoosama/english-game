// How the game's word and rule keys map to the ids the server uses for them.
// While the game still keys things by text, the server's rows carry that
// text in legacy_key; local mode needs no mapping (the key is the id).
export const identityIds = Object.freeze({ senseOf: (k) => k, keyOfSense: (id) => id, ruleOf: (k) => k, keyOfRule: (id) => id });

// { senseOf, keyOfSense, ruleOf, keyOfRule } from two key -> id maps.
export function idsFromMaps(senses, rules) {
  const bySense = new Map([...senses].map(([k, id]) => [id, k]));
  const byRule = new Map([...rules].map(([k, id]) => [id, k]));
  return { senseOf: (k) => senses.get(k), keyOfSense: (id) => bySense.get(id), ruleOf: (k) => rules.get(k), keyOfRule: (id) => byRule.get(id) };
}

const PAGE = 1000;
// key -> id for every row of the table that has a legacy key (paged, since
// the server answers at most 1000 rows a request).
export async function loadKeyMap(client, table) {
  const out = new Map();
  for (let from = 0; from < 100 * PAGE; from += PAGE) {
    const { data, error } = await client.from(table).select("id, legacy_key").not("legacy_key", "is", null).range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) out.set(r.legacy_key, r.id);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadIds(client) {
  const [senses, rules] = await Promise.all([loadKeyMap(client, "senses"), loadKeyMap(client, "grammar_rules")]);
  return { ids: idsFromMaps(senses, rules), words: senses.size, rules: rules.size };
}
