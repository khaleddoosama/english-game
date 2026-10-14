// The library API in local mode mirrors the server (migration 0026): views
// inside views, a word in several views, limits, and who owns what.
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalLibraryApi, MAX_VIEWS, senseFromCard, validViewName } from "../src/features/library/libraryApi.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
let storage, api;
const make = (user, canSee) => createLocalLibraryApi({ storage, me: () => user, canSee });
beforeEach(() => { storage = memory(); api = make("a"); });
const bad = async (p, text) => { try { await p; } catch (e) { expect(e.message).toMatch(text); return; } throw new Error("should have failed"); };

describe("views", () => {
  it("nest, and the path follows", async () => {
    const top = await api.create("A1.1"), movies = await api.create("movies", top), horror = await api.create("horror", movies);
    const tree = await api.tree();
    expect(tree.map((v) => v.path)).toEqual(["A1.1", "A1.1::movies", "A1.1::movies::horror"]);
    expect(tree.find((v) => v.id === horror).parent).toBe(movies);
  });

  it("refuse a repeated name in the same place, but allow it elsewhere; no '::'", async () => {
    const top = await api.create("A1.1");
    await api.create("movies", top);
    await bad(api.create("Movies", top), /already a view called/);
    await expect(api.create("movies")).resolves.toBeTruthy();
    await bad(api.create("a::b"), /no "::"/);
    expect(validViewName("  ")).toBe(false);
  });

  it("are 4 levels deep at most", async () => {
    let p = null;
    for (let i = 0; i < 4; i++) p = await api.create(`l${i}`, p);
    await bad(api.create("l4", p), /4 levels/);
  });

  it("rename and move take what is inside along; no moving into itself", async () => {
    const top = await api.create("A1.1"), movies = await api.create("movies", top), horror = await api.create("horror", movies);
    await api.rename(movies, "films");
    expect((await api.tree()).find((v) => v.id === horror).path).toBe("A1.1::films::horror");
    await bad(api.move(top, horror), /inside itself/);
    await api.move(horror, null);
    expect((await api.tree()).find((v) => v.id === horror).path).toBe("horror");
  });

  it("a move that would make it too deep is refused", async () => {
    let p = null;
    for (let i = 0; i < 3; i++) p = await api.create(`d${i}`, p);
    const loose = await api.create("loose"); await api.create("child", loose);
    await bad(api.move(loose, p), /4 levels/);
  });

  it("removing a view removes the ones inside; the name is free again", async () => {
    const top = await api.create("A1.1"); await api.create("movies", top);
    await api.remove(top);
    expect(await api.tree()).toEqual([]);
    await expect(api.create("A1.1")).resolves.toBeTruthy();
  });

  it("at most 200", async () => {
    for (let i = 0; i < MAX_VIEWS; i++) await api.create(`v${i}`);
    await bad(api.create("one too many"), /200 views/);
  });
});

describe("words and rules in views", () => {
  it("a word can sit in two views; the top view holds what is inside it", async () => {
    const top = await api.create("A1.1"), movies = await api.create("movies", top), other = await api.create("other");
    expect(await api.add(movies, ["s1"])).toBe(1);
    await api.add(other, ["s1", "s2"]);
    expect((await api.contents(top, true)).map((x) => x.id)).toEqual(["s1"]);
    expect(await api.contents(top, false)).toEqual([]);
    expect((await api.contents(other)).length).toBe(2);
    expect(await api.add(movies, ["s1"])).toBe(0);
  });

  it("adding to a view adds to the library; words that can't be seen are skipped", async () => {
    api = make("a", (id) => id !== "hidden");
    const v = await api.create("v");
    expect(await api.add(v, ["s1", "hidden"])).toBe(1);
    expect((await api.contents(v)).map((x) => x.id)).toEqual(["s1"]);
  });

  it("dropping from a view keeps the word in the library, and it can come back", async () => {
    const v = await api.create("v");
    await api.add(v, ["s1"]);
    await api.drop(v, "s1");
    expect(await api.contents(v)).toEqual([]);
    expect(await api.add(v, ["s1"])).toBe(1);
  });

  it("removing from the library takes the word out of every view", async () => {
    const v = await api.create("v"), w = await api.create("w");
    await api.add(v, ["s1", "s2"]); await api.add(w, ["s1"]);
    await api.libraryRemove("s1");
    expect((await api.contents(v)).map((x) => x.id)).toEqual(["s2"]);
    expect(await api.contents(w)).toEqual([]);
  });

  it("rules sit in views and count in the deep view", async () => {
    const top = await api.create("t"), sub = await api.create("s", top);
    await api.addRules(sub, ["r1", "r2"]);
    expect((await api.contents(top, true)).filter((x) => x.kind === "rule").length).toBe(2);
  });

  it("at most 200 words a call", async () => {
    const v = await api.create("v");
    await bad(api.add(v, Array.from({ length: 201 }, (_, i) => `s${i}`)), /200 words/);
  });
});

describe("my changes to a word", () => {
  it("are kept as a patch; an empty patch goes back; not for words outside the library", async () => {
    await bad(api.patch("s1", { meaning: "x" }), /not in your library/);
    await api.libraryAdd(["s1"]);
    await api.patch("s1", { meaning: "mine" }, "note");
    await bad(api.patch("s1", []), /object/);
    await api.patch("s1", {});
    await api.libraryRemove("s1");
    await bad(api.patch("s1", { meaning: "x" }), /not in your library/);
  });
});

describe("each player has their own", () => {
  it("views and library don't leak between players", async () => {
    await api.create("mine");
    const other = make("b");
    expect(await other.tree()).toEqual([]);
    await bad(other.add("whatever", ["s1"]), /does not exist/);
  });
});

describe("sharing a view (local mirror of migration 0029)", () => {
  const befriend = (x, y) => storage.setItem(`friends1:p:${[x, y].sort().join("|")}`, JSON.stringify({ status: "accepted" }));
  const names = () => storage.setItem("friends1:users", JSON.stringify({ a: "ann", b: "bob", c: "cat" }));
  const as = (user, canSee) => createLocalLibraryApi({ storage, me: () => user, canSee, areFriends: (x, y) => JSON.parse(storage.getItem(`friends1:p:${[x, y].sort().join("|")}`) || "null")?.status === "accepted", nameOf: (id) => ({ a: "ann", b: "bob", c: "cat" })[id] });
  let ann, bob, top, sub;
  beforeEach(async () => {
    names(); befriend("a", "b");
    ann = as("a"); bob = as("b");
    top = await ann.create("A1.1"); sub = await ann.create("movies", top);
    await ann.add(top, ["w1"]); await ann.add(sub, ["w2", "w3"]); await ann.addRules(sub, ["r1"]);
  });

  it("only to friends, only by the owner; an offer waits once", async () => {
    await bad(ann.share(top, ["c"]), /only with your friends/);
    await bad(bob.share(top, ["a"]), /does not exist/);
    expect(await ann.share(top, ["a"])).toBe(0);
    expect(await ann.share(top, ["b", "b"])).toBe(1);
    expect(await ann.share(top, ["b"])).toBe(0);
    await bad(ann.share(top, Array.from({ length: 21 }, (_, i) => `u${i}`)), /up to 20 friends/);
  });

  it("the inbox shows who sent what, and only to the friend", async () => {
    await ann.share(top, ["b"]);
    expect(await ann.inbox()).toEqual([]);
    expect(await as("c").inbox()).toEqual([]);
    const [item] = await bob.inbox();
    expect(item).toMatchObject({ name: "A1.1", from: "ann", words: 3, rules: 1, views: 2 });
  });

  it("accepting makes b's own copy, with the views inside, words and rules", async () => {
    await ann.share(top, ["b"]);
    const [{ id }] = await bob.inbox();
    await bad(as("c").accept(id), /no longer waiting/);
    const res = await bob.accept(id);
    expect(res).toMatchObject({ name: "A1.1 (from ann)", views: 2, words: 3, rules: 1, skipped: 0 });
    const tree = await bob.tree();
    expect(tree.map((v) => v.path)).toEqual(["A1.1 (from ann)", "A1.1 (from ann)::movies"]);
    expect((await bob.contents(res.view, true)).map((x) => x.id).sort()).toEqual(["r1", "w1", "w2", "w3"]);
    expect(await bob.inbox()).toEqual([]);
    await bad(bob.accept(id), /no longer waiting/);
  });

  it("the copy is independent of the original", async () => {
    await ann.share(top, ["b"]);
    const { view } = await bob.accept((await bob.inbox())[0].id);
    await ann.add(top, ["w9"]);
    await bob.rename(view, "Mine");
    expect((await bob.contents(view, true)).length).toBe(4);
    expect((await ann.tree())[0].name).toBe("A1.1");
  });

  it("a second copy gets a number; a dismissed offer can't be accepted but can be sent again", async () => {
    await ann.share(top, ["b"]); await bob.accept((await bob.inbox())[0].id);
    await ann.share(top, ["b"]);
    const second = await bob.accept((await bob.inbox())[0].id);
    expect(second.name).toBe("A1.1 (from ann) 2");
    await ann.share(top, ["b"]);
    const [{ id }] = await bob.inbox();
    await bob.dismiss(id);
    expect(await bob.inbox()).toEqual([]);
    await bad(bob.accept(id), /no longer waiting/);
    expect(await ann.share(top, ["b"])).toBe(1);
  });

  it("an offer of a view that was removed, or from someone no longer a friend, is not listed or accepted", async () => {
    await ann.share(top, ["b"]);
    const [{ id }] = await bob.inbox();
    storage.setItem("friends1:p:a|b", JSON.stringify({ status: "removed" }));
    expect(await bob.inbox()).toEqual([]);
    await bad(bob.accept(id), /no longer friends/);
    befriend("a", "b");
    await ann.remove(top);
    expect(await bob.inbox()).toEqual([]);
    await bad(bob.accept(id), /removed that view/);
  });

  it("no room for the copy: refused", async () => {
    await ann.share(top, ["b"]);
    for (let i = 0; i < MAX_VIEWS - 1; i++) await bob.create(`v${i}`);
    await bad(bob.accept((await bob.inbox())[0].id), /room for 2 more views/);
  });
});

describe("a word of my own", () => {
  it("a game card becomes the arguments of sense_create: columns apart, the rest as content", () => {
    const card = { word: " Quokka ", type: "vocab", partsOfSpeech: ["noun"], category: "Animals", meaning: "A small marsupial", situation: "We saw one.", gap: "We saw a ______.", hints: ["Australia"], _aiAdded: true, _autoStub: false, level: "A1.1", extra: "", other: null };
    expect(senseFromCard(card)).toEqual({ word: "Quokka", type: "vocab", pos: ["noun"], category: "Animals", meaning: "A small marsupial",
      content: { situation: "We saw one.", gap: "We saw a ______.", hints: ["Australia"] }, source: "ai" });
  });
  it("defaults: a typed-in card is a user word, no parts of speech, vocab", () => {
    expect(senseFromCard({ word: "x", meaning: "m" })).toMatchObject({ type: "vocab", pos: [], category: null, source: "user", content: {} });
    expect(senseFromCard(null).word).toBe("");
  });
  it("local mode: it joins the library and says if it was already there", async () => {
    const api = createLocalLibraryApi({ storage: memory(), me: () => "a" });
    expect(await api.createWord({ word: "Quokka", meaning: "m" })).toEqual({ id: "Quokka", existing: false });
    expect(await api.createWord({ word: "Quokka", meaning: "m" })).toEqual({ id: "Quokka", existing: true });
    await expect(api.createWord({ word: "", meaning: "m" })).rejects.toThrow(/1 to 120/);
  });
});

describe("my library as a list", () => {
  it("lists my words with how many views each is in, newest first; rules from my views", async () => {
    let t = 1000;
    const api = createLocalLibraryApi({ storage: memory(), me: () => "a", now: () => ++t });
    const v = await api.create("V"), w = await api.create("W");
    await api.add(v, ["w1", "w2"]); await api.add(w, ["w1"]); await api.libraryAdd(["w3"]); await api.addRules(v, ["r1"]);
    const { words, rules } = await api.libraryList();
    expect(words.map((x) => [x.id, x.views]).sort()).toEqual([["w1", 2], ["w2", 1], ["w3", 0]]);
    expect(rules.map((r) => r.id)).toEqual(["r1"]);
    await api.libraryRemove("w2");
    expect((await api.libraryList()).words.map((x) => x.id).sort()).toEqual(["w1", "w3"]);
  });
});

describe("sharing a view by link (local mirror of migration 0031)", () => {
  const as = (user, now) => createLocalLibraryApi({ storage, me: () => user, now, nameOf: (id) => ({ a: "ann", b: "bob", c: "cat" })[id] });
  let ann, bob, top, sub, clock;
  beforeEach(async () => {
    clock = 1000; const now = () => ++clock;
    ann = as("a", now); bob = as("b", now);
    top = await ann.create("A1.1 sports"); sub = await ann.create("football", top);
    await ann.add(top, ["w1"]); await ann.add(sub, ["w2"]); await ann.addRules(sub, ["r1"]);
  });

  it("only the owner can make a link; asking again gives the same one", async () => {
    const l = await ann.linkCreate(top);
    expect(l.token.length).toBeGreaterThan(20);
    expect((await ann.linkCreate(top)).token).toBe(l.token);
    await bad(bob.linkCreate(top), /does not exist/);
  });

  it("what it shows, to anyone (no friendship needed)", async () => {
    const { token } = await ann.linkCreate(top);
    expect(await bob.linkInfo(token)).toMatchObject({ valid: true, name: "A1.1 sports", from: "ann", words: 2, rules: 1, views: 2, mine: false, taken: false });
    expect((await ann.linkInfo(token)).mine).toBe(true);
    expect(await bob.linkInfo("nope")).toEqual({ valid: false, reason: "not_found" });
  });

  it("taking it makes my own copy; taking it twice gives the same one; the owner can't take their own", async () => {
    const { token } = await ann.linkCreate(top);
    const got = await bob.linkAccept(token);
    expect(got).toMatchObject({ name: "A1.1 sports (from ann)", views: 2, words: 2, rules: 1 });
    expect((await bob.contents(got.view, true)).map((x) => x.id).sort()).toEqual(["r1", "w1", "w2"]);
    expect((await bob.linkInfo(token)).taken).toBe(true);
    const again = await bob.linkAccept(token);
    expect(again).toMatchObject({ already: true, view: got.view });
    expect((await bob.tree()).length).toBe(2);
    await bad(ann.linkAccept(token), /your own view/);
    expect((await ann.linkInfo(token)).mine).toBe(true);
  });

  it("after removing the copy it can be taken again, as a new one", async () => {
    const { token } = await ann.linkCreate(top);
    const first = await bob.linkAccept(token);
    await bob.remove(first.view);
    const second = await bob.linkAccept(token);
    expect(second.view).not.toBe(first.view);
    expect(second.already).toBeUndefined();
  });

  it("taking it back, running out, and a removed view all stop it", async () => {
    const { token } = await ann.linkCreate(top);
    await bob.linkRevoke(token);                                     // not the owner: nothing happens
    expect((await bob.linkInfo(token)).valid).toBe(true);
    await ann.linkRevoke(token);
    expect(await bob.linkInfo(token)).toEqual({ valid: false, reason: "taken_back" });
    await bad(bob.linkAccept(token), /no longer works/);
    const fresh = await ann.linkCreate(top);
    expect(fresh.token).not.toBe(token);
    const late = as("b", () => Date.now() + 40 * 86400000);          // 40 days on
    expect(await late.linkInfo(fresh.token)).toEqual({ valid: false, reason: "expired" });
    await ann.remove(top);
    expect(await bob.linkInfo(fresh.token)).toEqual({ valid: false, reason: "removed" });
  });

  it("the copy is independent of the original", async () => {
    const { token } = await ann.linkCreate(top);
    const got = await bob.linkAccept(token);
    await bob.rename(got.view, "Mine now");
    await ann.add(top, ["w9"]);
    expect((await ann.tree())[0].name).toBe("A1.1 sports");
    expect((await bob.contents(got.view, true)).length).toBe(3);
  });

  it("at most 50 links open, and no room for the copy is refused", async () => {
    const { token } = await ann.linkCreate(top);
    for (let i = 0; i < 49; i++) await ann.linkCreate(await ann.create(`v${i}`));
    await bad(ann.linkCreate(await ann.create("one more")), /50 links/);
    for (let i = 0; i < 199; i++) await bob.create(`b${i}`);
    await bad(bob.linkAccept(token), /room for 2 more views/);
  });
});

describe("the catalog (local mirror of migration 0032)", () => {
  const as = (user, now, isAdmin = () => false) => createLocalLibraryApi({ storage, me: () => user, now, isAdmin, nameOf: (id) => ({ a: "ann", b: "bob", c: "cat" })[id] });
  let ann, bob, top, sub;
  beforeEach(async () => {
    let clock = 1000; const now = () => ++clock;
    ann = as("a", now); bob = as("b", now);
    top = await ann.create("Movies"); sub = await ann.create("Horror", top);
    await ann.add(top, ["w1"]); await ann.add(sub, ["w2"]); await ann.addRules(top, ["r1"]);
  });

  it("only the owner publishes, with a title; publishing again updates the same entry", async () => {
    await bad(bob.catalogPublish(top, "x"), /does not exist/);
    await bad(ann.catalogPublish(top, "  "), /title/);
    await bad(ann.catalogPublish(top, "x".repeat(61)), /title/);
    await bad(ann.catalogPublish(top, "ok", "x".repeat(301)), /description/);
    const e = await ann.catalogPublish(top, "  Movie night ", "Scary");
    expect(e.title).toBe("Movie night");
    expect((await ann.catalogPublish(top, "Movie night 2", "Scary")).id).toBe(e.id);
    expect((await bob.catalogList()).length).toBe(1);
  });

  it("everyone can browse and search (title, description, owner); counts show what it holds", async () => {
    await ann.catalogPublish(top, "Movie night", "Scary and fun");
    const [e] = await bob.catalogList();
    expect(e).toMatchObject({ title: "Movie night", from: "ann", words: 2, rules: 1, views: 2, mine: false, taken: false });
    for (const q of ["movie", "SCARY", "ann"]) expect((await bob.catalogList(q)).length).toBe(1);
    expect((await bob.catalogList("zzz")).length).toBe(0);
    expect((await ann.catalogList())[0].mine).toBe(true);
  });

  it("taking makes my own copy; twice gives the same one; the owner can't take their own", async () => {
    const { id } = await ann.catalogPublish(top, "Movie night");
    const got = await bob.catalogTake(id);
    expect(got).toMatchObject({ views: 2, words: 2, rules: 1 });
    expect((await bob.contents(got.view, true)).map((x) => x.id).sort()).toEqual(["r1", "w1", "w2"]);
    expect((await bob.catalogList())[0]).toMatchObject({ taken: true, takes: 1 });
    expect(await bob.catalogTake(id)).toMatchObject({ already: true, view: got.view });
    expect((await bob.catalogList())[0].takes).toBe(1);
    await bad(ann.catalogTake(id), /your own view/);
  });

  it("taking down: the owner or an admin; the copy stays; it can be published again", async () => {
    const { id } = await ann.catalogPublish(top, "Movie night");
    const copy = await bob.catalogTake(id);
    await bob.catalogUnpublish(id);                                        // not the owner: nothing happens
    expect((await bob.catalogList()).length).toBe(1);
    await as("c", () => 5000, () => true).catalogUnpublish(id);            // an admin
    expect((await bob.catalogList()).length).toBe(0);
    await bad(bob.catalogTake(id), /no longer in the catalog/);
    expect((await bob.tree()).some((v) => v.id === copy.view)).toBe(true);
    expect((await ann.catalogPublish(top, "Again")).id).not.toBe(id);
  });

  it("the owner (or an admin) edits the title and description; the list carries when, and the view only for the owner", async () => {
    const { id } = await ann.catalogPublish(top, "Movie night", "Scary");
    await bad(bob.catalogEdit(id, "hack"), /not yours/);
    await bad(ann.catalogEdit(id, " "), /title/);
    expect((await ann.catalogEdit(id, "Renamed", "New text")).title).toBe("Renamed");
    expect((await ann.catalogList())[0]).toMatchObject({ title: "Renamed", description: "New text", view: top });
    expect((await bob.catalogList())[0].view).toBeNull();
    expect((await as("c", () => 9000, () => true).catalogEdit(id, "By admin")).title).toBe("By admin");
  });

  it("a removed view drops out, and 20 open entries is the most", async () => {
    await ann.catalogPublish(top, "Movie night");
    await ann.remove(top);
    expect((await bob.catalogList()).length).toBe(0);
    for (let i = 1; i <= 20; i++) await ann.catalogPublish(await ann.create(`V${i}`), `T${i}`);
    await bad(ann.catalogPublish(await ann.create("V21"), "T21"), /20 views/);
  });
});

describe("grammar rules in the library (local mirror of migration 0035)", () => {
  let ann, bob, v;
  beforeEach(async () => { ann = createLocalLibraryApi({ storage, me: () => "a" }); bob = createLocalLibraryApi({ storage, me: () => "b" }); v = await ann.create("G"); });
  it("rules go into the library without a view, and adding again changes nothing", async () => {
    expect(await ann.libraryAddRules(["r1", "r2"])).toBe(2);
    expect(await ann.libraryAddRules(["r1"])).toBe(0);
    expect((await ann.libraryList()).rules.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
  it("a rule put in a view is in the library; taking it out of the view keeps it there", async () => {
    await ann.addRules(v, ["r1"]);
    expect((await ann.libraryList()).rules.map((r) => r.id)).toEqual(["r1"]);
    await ann.dropRule(v, "r1");
    expect((await ann.contents(v, false)).length).toBe(0);
    expect((await ann.libraryList()).rules.map((r) => r.id)).toEqual(["r1"]);
  });
  it("removing from the library takes it out of every view of mine, and can be added back", async () => {
    const w = await ann.create("W");
    await ann.addRules(v, ["r1"]); await ann.addRules(w, ["r1", "r2"]);
    await ann.libraryRemoveRule("r1");
    expect((await ann.libraryList()).rules.map((r) => r.id)).toEqual(["r2"]);
    expect((await ann.contents(v, false)).length).toBe(0);
    expect((await ann.contents(w, false)).map((x) => x.id)).toEqual(["r2"]);
    expect(await ann.libraryAddRules(["r1"])).toBe(1);
  });
  it("someone else's library and views are not touched, and 200 is the most at a time", async () => {
    await ann.addRules(v, ["r1"]);
    await bob.libraryRemoveRule("r1"); await bob.dropRule(v, "r1");
    expect((await ann.libraryList()).rules.length).toBe(1);
    expect((await ann.contents(v, false)).length).toBe(1);
    await bad(ann.libraryAddRules(Array.from({ length: 201 }, (_, i) => `r${i}`)), /up to 200 rules/);
  });
});
