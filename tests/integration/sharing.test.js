// Scenario 5: sharing a view with a friend, by link, and through the catalog,
// and who gets to see what. App layer: the online library API. Database:
// view_share*, view_link_*, catalog_*, RLS, the friend functions.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/idb", async () => (await import("./devices.js")).idbMock);

import { createOnlineLibraryApi } from "../../src/features/library/onlineLibraryApi.js";
import { loadIds } from "../../src/features/library/libraryIds.js";
import { PGURL, anon, befriend, cleanup, newTag, promote, signUp, superuser } from "./harness";
import { resetDevices } from "./devices";
import { adminPublisher, rule } from "./content";
import { word } from "../libraryFixtures";

describe.skipIf(!PGURL)("sharing a view", () => {
  const tag = newTag();
  const N = (s) => `${tag}${s}`;
  let admin, ann, bob, cat, dan, A, B, C, D, ids;
  let trip, food, own;                                     // Ann's views and her own word

  const keys = async (api, client, view, deep = true) => {
    const { ids: map } = await loadIds(client);
    return (await api.contents(view, deep)).map((r) => map[r.kind === "sense" ? "keyOfSense" : "keyOfRule"](r.id)).sort();
  };

  beforeAll(async () => {
    resetDevices();
    admin = promote(await signUp(`${tag}adm`));
    [ann, bob, cat, dan] = await Promise.all(["ann", "bob", "cat", "dan"].map((n) => signUp(`${tag}${n}`)));
    await befriend(ann, bob);                              // Cat and Dan are nobody's friends; Ann and Cat are not friends either
    const course = await adminPublisher(admin);
    await course.publish((c) => {
      c.words.push(word(N("Plane"), { category: N("Travel") }), word(N("Ticket"), { category: N("Travel") }), word(N("Burger"), { category: N("Food") }));
      c.grammar.push(rule(N("g-past")));
    });
    A = createOnlineLibraryApi(ann.client); B = createOnlineLibraryApi(bob.client); C = createOnlineLibraryApi(cat.client); D = createOnlineLibraryApi(dan.client);
    ids = (await loadIds(ann.client)).ids;
    own = (await A.createWord({ word: N("Quokka"), meaning: "A small marsupial", situation: "We saw one." })).id;
    trip = await A.create("Trip");
    food = await A.create("Food", trip);
    await A.add(trip, [ids.senseOf(N("Plane")), ids.senseOf(N("Ticket")), own]);
    await A.add(food, [ids.senseOf(N("Burger")), own]);
    await A.addRules(trip, [ids.ruleOf(N("g-past"))]);
  });
  afterAll(() => cleanup(tag));

  describe("to a friend", () => {
    let shareId, copy;
    it("only friends can be offered a view, and only by its owner", async () => {
      await expect(A.share(trip, [cat.id])).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/only with your friends/) });
      await expect(B.share(trip, [ann.id])).rejects.toMatchObject({ code: "P0002" });      // Bob doesn't own it: for him it doesn't exist
      expect(await A.share(trip, [bob.id])).toBe(1);
      expect(await A.share(trip, [bob.id])).toBe(0);                                       // an offer waits once
    });

    it("the offer is in the friend's inbox and nobody else's", async () => {
      const inbox = await B.inbox();
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ name: "Trip", from: `${tag}ann`, words: 3, rules: 1 });
      shareId = inbox[0].id;
      expect(await C.inbox()).toEqual([]);
      expect(await A.inbox()).toEqual([]);
      const direct = await cat.client.from("collection_shares").select("id");               // and not through the table either
      expect(direct.data).toEqual([]);
      expect((await bob.client.from("collection_shares").select("id")).data).toHaveLength(1);
      await expect(createOnlineLibraryApi(anon()).inbox()).rejects.toMatchObject({ code: "42501" });
    });

    it("someone else cannot accept or dismiss it", async () => {
      await expect(C.accept(shareId)).rejects.toMatchObject({ code: "P0002" });
      await expect(C.dismiss(shareId)).resolves.not.toThrow();
      expect(await B.inbox()).toHaveLength(1);                                             // still there: Cat's dismissal did nothing
    });

    it("accepting gives the friend their own copy: the views inside, the words, the rule", async () => {
      copy = await B.accept(shareId);
      expect(copy).toMatchObject({ name: `Trip (from ${tag}ann)`, views: 2, words: 3, rules: 1 });
      const mine = await B.tree();
      expect(mine.map((v) => v.name).sort()).toEqual(["Food", `Trip (from ${tag}ann)`]);
      const tripCopy = mine.find((v) => v.name.startsWith("Trip"));
      expect(await keys(B, bob.client, tripCopy.id)).toEqual([N("g-past"), N("Plane"), N("Burger"), N("Ticket")].sort());
      expect(await B.inbox()).toEqual([]);
    });

    it("her own word does not come with it: it stays private, and the friend is told it was left out (once for each view it was in)", async () => {
      expect(copy.skipped).toBe(2);
      const { ids: bobIds } = await loadIds(bob.client);
      expect(bobIds.senseOf(N("Quokka"))).toBeUndefined();
      expect((await bob.client.from("senses").select("id").eq("id", own)).data).toEqual([]);
      const bobsWords = (await B.libraryList()).words.map((w) => w.id);
      expect(bobsWords).not.toContain(own);
      expect(bobsWords).toContain(ids.senseOf(N("Plane")));                                // the course words are in his library now
      expect(superuser.rows(`select 1 from public.library_entries where user_id = '${bob.id}' and sense_id = '${own}'`)).toEqual([]);
    });

    it("an offer can only be accepted once", async () => {
      await expect(B.accept(shareId)).rejects.toMatchObject({ code: "P0002", message: expect.stringMatching(/no longer waiting/) });
    });

    it("the copy is his: changes on either side do not reach the other", async () => {
      const tripCopy = (await B.tree()).find((v) => v.name.startsWith("Trip"));
      await A.drop(trip, ids.senseOf(N("Plane")));
      await A.remove(food);
      expect(await keys(B, bob.client, tripCopy.id)).toContain(N("Plane"));
      expect((await B.tree()).map((v) => v.name)).toContain("Food");
      await B.rename(tripCopy.id, "Bob's trip");
      expect((await A.tree()).map((v) => v.name)).toContain("Trip");
      await A.add(trip, [ids.senseOf(N("Plane"))]);
    });

    it("when the friendship ends, the waiting offer leaves the inbox and the count, and a new friendship does not bring it back", async () => {
      await A.share(trip, [bob.id]);
      const offer = (await B.inbox())[0];
      const before = (await B.tree()).length;
      expect((await B.inbox()).length).toBe(1);                                            // what the red badge counts
      await ann.client.rpc("friend_remove", { p_user: bob.id });
      expect(await B.inbox()).toEqual([]);                                                 // no offer, no badge
      await expect(B.accept(offer.id)).rejects.toMatchObject({ code: "P0002", message: expect.stringMatching(/no longer waiting/) });
      expect((await B.tree()).length).toBe(before);
      await befriend(ann, bob);                                                            // friends again
      expect(await B.inbox()).toEqual([]);                                                 // the old offer stays gone
      expect(await A.share(trip, [bob.id])).toBe(1);                                       // the sender may offer it again
      const fresh = (await B.inbox())[0];
      expect(fresh.id).not.toBe(offer.id);
    });

    it("friendship removed and restored before the inbox is opened: the old offer cannot be accepted, copies already taken stay", async () => {
      await A.share(trip, [bob.id]);
      const keep = (await B.accept((await B.inbox())[0].id)).view;                         // taken before: a copy Bob owns
      await A.share(trip, [bob.id]);                                                       // Bob never looks at the inbox from here on
      const old = superuser.one(`select id from public.collection_shares where from_user = '${ann.id}' and to_user = '${bob.id}' and status = 'pending'`);
      await ann.client.rpc("friend_remove", { p_user: bob.id });
      await befriend(ann, bob);                                                            // friends again at once
      await expect(B.accept(old)).rejects.toMatchObject({ code: "P0002", message: expect.stringMatching(/no longer waiting/) });
      expect(await B.inbox()).toEqual([]);
      expect((await B.tree()).map((v) => v.id)).toContain(keep);
      expect(await A.share(trip, [bob.id])).toBe(1);                                       // a new offer under the new friendship works
      expect(await B.inbox()).toHaveLength(1);
    });

    it("what a friend already accepted stays when the friendship ends", async () => {
      const taken = (await B.inbox())[0];
      const copy = await B.accept(taken.id);
      await ann.client.rpc("friend_remove", { p_user: bob.id });
      expect((await B.tree()).map((v) => v.id)).toContain(copy.view);
      expect(await keys(B, bob.client, copy.view)).toContain(N("Ticket"));
      await befriend(ann, bob);
    });

    it("the server still checks the friendship when accepting, for an offer that is still waiting", async () => {
      await A.share(food === undefined ? trip : trip, [bob.id]);
      const offer = (await B.inbox())[0];
      superuser.sql(`update public.friendships set status = 'removed' where user_a = least('${ann.id}'::uuid, '${bob.id}'::uuid) and user_b = greatest('${ann.id}'::uuid, '${bob.id}'::uuid)`);   // ended without friend_remove
      await expect(B.accept(offer.id)).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/no longer friends/) });
      expect(await B.inbox()).toEqual([]);                                                 // hidden, and ended on sight
      superuser.sql(`update public.friendships set status = 'accepted' where user_a = least('${ann.id}'::uuid, '${bob.id}'::uuid) and user_b = greatest('${ann.id}'::uuid, '${bob.id}'::uuid)`);
      expect(await B.inbox()).toEqual([]);                                                 // and not back with the friendship
    });

    it("an offer cannot be accepted once the view is gone", async () => {
      const extra = await A.create("Extra");
      await A.share(extra, [bob.id]);
      const offer2 = (await B.inbox()).find((o) => o.name === "Extra");
      await A.remove(extra);
      expect((await B.inbox()).map((o) => o.name)).not.toContain("Extra");
      await expect(B.accept(offer2.id)).rejects.toMatchObject({ code: "P0002" });
    });
  });

  describe("by link", () => {
    let link;
    it("anyone signed in can look at it and take a copy, the owner cannot take it, a stranger to the app cannot even look", async () => {
      link = await A.linkCreate(trip);
      expect(link.token.length).toBeGreaterThan(20);
      expect((await A.linkCreate(trip)).token).toBe(link.token);                           // asking again gives the same link
      expect(await D.linkInfo(link.token)).toMatchObject({ valid: true, name: "Trip", from: `${tag}ann`, mine: false });
      await expect(createOnlineLibraryApi(anon()).linkInfo(link.token)).rejects.toMatchObject({ code: "42501" });
      await expect(A.linkAccept(link.token)).rejects.toMatchObject({ message: expect.stringMatching(/your own view/) });
      const got = await D.linkAccept(link.token);
      expect(got).toMatchObject({ words: expect.any(Number), skipped: 1 });
      expect((await D.linkAccept(link.token)).already).toBe(true);
      expect((await loadIds(dan.client)).ids.senseOf(N("Quokka"))).toBeUndefined();
    });

    it("only the owner sees her links and can take one back; after that nobody can use it", async () => {
      expect((await ann.client.from("view_links").select("token")).data).toHaveLength(1);
      expect((await dan.client.from("view_links").select("token")).data).toEqual([]);
      await D.linkRevoke(link.token);                                                      // not Dan's: nothing happens
      expect((await C.linkInfo(link.token)).valid).toBe(true);
      await A.linkRevoke(link.token);
      expect(await C.linkInfo(link.token)).toEqual({ valid: false, reason: "taken_back" });
      await expect(C.linkAccept(link.token)).rejects.toMatchObject({ message: expect.stringMatching(/no longer works/) });
    });

    it("a link runs out after 30 days", async () => {
      const fresh = await A.linkCreate(food === undefined ? trip : trip);
      superuser.sql(`update public.view_links set expires_at = now() - interval '1 minute' where token = '${fresh.token}'`);   // the test controls the clock
      expect(await C.linkInfo(fresh.token)).toEqual({ valid: false, reason: "expired" });
      await expect(C.linkAccept(fresh.token)).rejects.toMatchObject({ code: "P0002" });
    });

    it("it dies with the view", async () => {
      const gone = await A.create("Gone");
      const l = await A.linkCreate(gone);
      await A.remove(gone);
      expect((await C.linkInfo(l.token)).valid).toBe(false);
    });
  });

  describe("through the catalog", () => {
    let entry;
    it("a published view can be found and taken by any signed-in player, with the same privacy", async () => {
      entry = await A.catalogPublish(trip, `${tag} Travel words`, "Planes and tickets");
      const found = await C.catalogList(`${tag} travel`, 10);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ id: entry.id, from: `${tag}ann`, mine: false, taken: false });
      const got = await C.catalogTake(entry.id);
      expect(got.skipped).toBe(1);
      expect((await C.catalogList(`${tag} travel`, 10))[0].taken).toBe(true);
      expect((await loadIds(cat.client)).ids.senseOf(N("Quokka"))).toBeUndefined();
      await expect(createOnlineLibraryApi(anon()).catalogList("", 10)).rejects.toMatchObject({ code: "42501" });
    });

    it("only the owner (or an admin) can change or take down an entry", async () => {
      await expect(C.catalogEdit(entry.id, "Mine now", "")).rejects.toMatchObject({ code: "P0002" });
      await C.catalogUnpublish(entry.id);                                                  // not hers: quietly does nothing
      expect(await A.catalogList(`${tag} travel`, 10)).toHaveLength(1);
      await createOnlineLibraryApi(admin.client).catalogUnpublish(entry.id);
      expect(await C.catalogList(`${tag} travel`, 10)).toEqual([]);
      expect((await C.tree()).length).toBeGreaterThan(0);                                  // the copy already taken stays
    });
  });
});
