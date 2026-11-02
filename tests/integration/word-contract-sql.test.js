// The word contract in SQL (public.word_contract_errors, migration 0044) against the shared cases: it must give the
// same 'path: code' problems as checkWord in JavaScript (tests/word-contract.test.js), case by case. ADR 0011 step 1:
// the function is attached to nothing. It is called here as the database owner, because that is who will call it (a
// trigger, in a later step); no app role may run it, which is checked too. Made-up words only.
import { afterAll, describe, expect, it } from "vitest";
import { checkWord } from "../../src/engine/wordContract.js";
import { WORD_CONTRACT_CASES } from "../wordContractCases.js";
import { PGURL, anon, cleanup, newTag, signUp, superuser } from "./harness";

const literal = (word) => `'${JSON.stringify(word).replace(/'/g, "''")}'::jsonb`;
const sqlErrors = (word) => superuser.rows(`select unnest(public.word_contract_errors(${literal(word)})) as e`).map((r) => r.e).sort();

describe.skipIf(!PGURL)("the word contract in SQL agrees with JavaScript", () => {
  const tag = newTag();
  afterAll(() => cleanup(tag));
  it.each(WORD_CONTRACT_CASES.map((c) => [c.name, c]))("%s", (_name, c) => {
    const js = checkWord(c.word).errors.map((e) => `${e.path}: ${e.code}`).sort();
    expect(js).toEqual([...c.errors].sort());
    expect(sqlErrors(c.word)).toEqual(js);
  });

  it("no app role may run it, and nothing uses it yet", async () => {
    const player = await signUp(`${tag}p`);
    for (const who of [anon(), player.client]) {
      const r = await who.rpc("word_contract_errors", { p_data: WORD_CONTRACT_CASES[0].word });
      expect(r.error?.code).toBe("42501");
    }
    expect(superuser.rows(`select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname like 'word_contract%'`)).toEqual([]);
    // No other function calls it (only word_contract_errors calls its own helper).
    expect(superuser.rows(`select proname from pg_proc where prosrc like '%word_contract_%' and proname not like 'word_contract_%'`)).toEqual([]);
  });
});
