// Words and grammar rules an admin has just created join their own library, so
// what they add in the editor or by import shows up where they pick words for
// a view. Only new items: one the admin took out of their library is not put
// back by editing it. Best effort, like the dictionary sync it follows.
const KEYS_PER_LOOKUP = 100;   // the key list goes in the address of the request
const PER_CALL = 200;          // library_add / library_add_rules take up to 200

async function idsFor(sb, table, keys) {
  const ids = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_LOOKUP) {
    const { data, error } = await sb.from(table).select("id").in("legacy_key", keys.slice(i, i + KEYS_PER_LOOKUP));
    if (error) throw error;
    for (const r of data || []) ids.push(r.id);
  }
  return ids;
}

async function addAll(sb, fn, param, ids) {
  for (let i = 0; i < ids.length; i += PER_CALL) {
    const { error } = await sb.rpc(fn, { [param]: ids.slice(i, i + PER_CALL) });
    if (error) throw error;
  }
}

// fresh: [{ kind: "words" | "grammar", key }]; returns how many it put in.
export async function addNewToLibrary(sb, fresh) {
  const words = fresh.filter((r) => r.kind === "words").map((r) => r.key);
  const rules = fresh.filter((r) => r.kind === "grammar").map((r) => r.key);
  const wordIds = words.length ? await idsFor(sb, "senses", words) : [];
  const ruleIds = rules.length ? await idsFor(sb, "grammar_rules", rules) : [];
  await addAll(sb, "library_add", "p_senses", wordIds);
  await addAll(sb, "library_add_rules", "p_rules", ruleIds);
  return wordIds.length + ruleIds.length;
}
