// Scenario 1: a player writes a word of their own, and a new session loads the
// whole card back. App layer: the online library API (onlineLibraryApi.js) and
// the id loader (libraryIds.js). Database: sense_create, library_*, view_*, RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOnlineLibraryApi } from "../../src/features/library/onlineLibraryApi.js";
import { loadIds } from "../../src/features/library/libraryIds.js";
import { PGURL, anon, as, cleanup, newTag, signUp } from "./harness";

describe.skipIf(!PGURL)("a word of my own, end to end", () => {
  const tag = newTag();
  let ann, bob, word, card;
  beforeAll(async () => {
    ann = await signUp(`${tag}ann`);
    bob = await signUp(`${tag}bob`);
    word = `${tag}Quokka`;
    card = { word, type: "vocab", partsOfSpeech: ["noun"], category: "Animals", meaning: "A small marsupial from Australia", situation: "We saw a quokka at the zoo.", gap: "We saw a ______ at the zoo.", hints: ["It looks like it is smiling"], synonyms: ["Marsupial"], translation: { ar: "كوالا صغير" } };
  });
  afterAll(() => cleanup(tag));

  const SENSE_COLUMNS = "id, label, type, pos, category, meaning, content, visibility, owner_id, source, deleted_at, headwords(text)";
  // The card as the game holds it, rebuilt from the database row (the reverse of senseFromCard).
  const cardOf = (row) => ({ word: row.label ? `${row.headwords.text} (${row.label})` : row.headwords.text, type: row.type, partsOfSpeech: row.pos, category: row.category, meaning: row.meaning, ...row.content });

  it("is saved, and a brand-new session (new client, nothing cached) loads the whole card", async () => {
    const created = await createOnlineLibraryApi(ann.client).createWord(card);
    expect(created).toEqual({ id: expect.any(String), existing: false });

    // A new session: a new client and a new API object. Everything below comes from the database.
    const later = as(ann.id);
    const library = createOnlineLibraryApi(later);
    const listed = (await library.libraryList()).words.find((w) => w.id === created.id);
    expect(listed).toMatchObject({ id: created.id, note: null, patch: {}, views: 0 });

    const { ids, words } = await loadIds(later);
    expect(words).toBeGreaterThanOrEqual(1);
    expect(ids.senseOf(word)).toBe(created.id);               // the game's key for it is its text
    expect(ids.keyOfSense(created.id)).toBe(word);

    const row = (await later.from("senses").select(SENSE_COLUMNS).eq("id", created.id).single()).data;
    expect(row).toMatchObject({ visibility: "private", owner_id: ann.id, source: "user", deleted_at: null });
    expect(cardOf(row)).toEqual(card);                           // every field, including nested ones and non-Latin text
  });

  it("making the same word again gives back the one that exists, whatever the case, and does not duplicate it", async () => {
    const library = createOnlineLibraryApi(ann.client);
    const again = await library.createWord({ ...card, word: word.toUpperCase(), meaning: "Another wording" });
    const first = (await library.libraryList()).words.filter((w) => w.added_at);
    expect(again.existing).toBe(true);
    expect(first.filter((w) => w.id === again.id)).toHaveLength(1);
    const row = (await ann.client.from("senses").select("meaning").eq("id", again.id).single()).data;
    expect(row.meaning).toBe(card.meaning);                      // the first wording is kept
  });

  it("a meaning label makes another sense of the same headword", async () => {
    const library = createOnlineLibraryApi(ann.client);
    const plain = await library.createWord({ ...card, word, meaning: card.meaning });
    const labelled = await library.createWord({ ...card, word: `${word} (to joke)`, meaning: "To make fun of someone" });
    expect(labelled.existing).toBe(false);
    expect(labelled.id).not.toBe(plain.id);
    const { ids } = await loadIds(ann.client);
    expect(ids.senseOf(`${word} (to joke)`)).toBe(labelled.id);
    expect(ids.senseOf(word)).toBe(plain.id);
  });

  it("goes into a view, and the view hands back the same id", async () => {
    const library = createOnlineLibraryApi(ann.client);
    const id = (await library.createWord({ ...card, meaning: card.meaning })).id;
    const view = await library.create("Animals");
    expect(await library.add(view, [id])).toBe(1);
    expect((await library.contents(view)).filter((r) => r.kind === "sense").map((r) => r.id)).toContain(id);
    expect((await library.libraryList()).words.find((w) => w.id === id).views).toBe(1);
  });

  it("is refused by the database when it is not a word: no name, too long, no meaning, a card that is not an object", async () => {
    const library = createOnlineLibraryApi(ann.client);
    await expect(library.createWord({ word: "", meaning: "m" })).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/1 to 120/) });
    await expect(library.createWord({ word: "x".repeat(121), meaning: "m" })).rejects.toMatchObject({ code: "22023" });
    await expect(library.createWord({ word: `${tag}Empty`, meaning: "   " })).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/meaning/) });
    const direct = await ann.client.rpc("sense_create", { p_word: `${tag}Arr`, p_meaning: "m", p_content: [1, 2] });
    expect(direct.error).toMatchObject({ code: "22023" });
    const noName = await ann.client.rpc("sense_create", { p_word: "(to joke)", p_meaning: "m" });
    expect(noName.error).toMatchObject({ code: "22023" });
  });

  it("an unknown type becomes vocab, and an AI helper's word is marked as AI-written", async () => {
    const r = await ann.client.rpc("sense_create", { p_word: `${tag}Odd`, p_type: "weird", p_meaning: "m", p_source: "ai" });
    const row = (await ann.client.from("senses").select("type, source").eq("id", r.data.id).single()).data;
    expect(row).toEqual({ type: "vocab", source: "ai" });
    const forged = await ann.client.rpc("sense_create", { p_word: `${tag}Forged`, p_meaning: "m", p_source: "curated" });
    expect((await ann.client.from("senses").select("source").eq("id", forged.data.id).single()).data.source).toBe("user");   // a player cannot claim to be the course
  });

  it("is private: nobody else can read it, add it, change it or see it in their lists", async () => {
    const id = (await createOnlineLibraryApi(ann.client).createWord(card)).id;
    const other = createOnlineLibraryApi(bob.client);
    expect((await bob.client.from("senses").select("id").eq("id", id)).data).toEqual([]);
    expect(await other.libraryAdd([id])).toEqual([]);          // skipped, as a word that cannot be seen
    await expect(other.patch(id, { meaning: "mine now" })).rejects.toMatchObject({ code: "P0002" });
    expect((await other.libraryList()).words.map((w) => w.id)).not.toContain(id);
    expect((await loadIds(bob.client)).ids.senseOf(word)).toBeUndefined();
    // and no way around the functions: the table itself takes no writes from a player
    const hijack = await bob.client.from("senses").update({ meaning: "hacked" }).eq("id", id).select("id");
    expect(hijack.error).toMatchObject({ code: "42501" });
    expect((await ann.client.from("senses").select("meaning").eq("id", id).single()).data.meaning).toBe(card.meaning);
  });

  it("is for signed-in players only", async () => {
    await expect(createOnlineLibraryApi(anon()).createWord({ word: `${tag}Anon`, meaning: "m" })).rejects.toMatchObject({ code: "42501" });
    await expect(createOnlineLibraryApi(anon()).libraryList()).rejects.toMatchObject({ code: "42501" });
  });
});
