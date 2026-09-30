// The repo only sends what changed. These tests run it against an in-memory
// Supabase fake built from the migration's function semantics.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSupabaseRepo } from "../src/lib/repo";
import { migrateProgressData } from "../src/engine/progress";
import { V2 } from "../src/engine/v2";
import { createFakeSupabase } from "./fakeSupabase";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const content = V2.withoutRemovedFields({
  words: backup.words, grammar: backup.grammar, challenges: backup.challenges,
  stories: backup.stories, combos: backup.combos, levelOrder: backup.levelOrder, note: backup.note,
});
const rpcCalls = (fake, name) => fake.calls.filter((c) => c.rpc === name);

describe("content", () => {
  it("round-trips the whole backup in order", async () => {
    const fake = createFakeSupabase();
    const admin = createSupabaseRepo({ userId: "u1", isAdmin: true, client: fake });
    await admin.loadContent();
    await admin.saveContent(content);
    const player = createSupabaseRepo({ userId: "u2", isAdmin: false, client: fake });
    const loaded = await player.loadContent();
    for (const kind of ["words", "grammar", "challenges", "stories", "combos"]) expect(loaded[kind]).toEqual(content[kind]);
    expect(loaded.levelOrder).toEqual(content.levelOrder);
  });

  it("sends one row for an edit, a tombstone for a delete, and no renumbering", async () => {
    const fake = createFakeSupabase();
    const admin = createSupabaseRepo({ userId: "u1", isAdmin: true, client: fake });
    await admin.loadContent();
    await admin.saveContent(content);
    const before = fake.calls.length;
    const words = content.words.map((w, i) => (i === 10 ? { ...w, meaning: "edited" } : w)).filter((_, i) => i !== 20);
    words.splice(5, 0, { word: "brand-new", category: content.words[5].category, meaning: "x", situation: "y", gap: "a ______ b" });
    await admin.saveContent({ ...content, words });
    const [call] = rpcCalls(fake, "apply_content_changes").slice(-1);
    expect(fake.calls.length - before).toBe(1);
    expect(call.args.p_upserts.map((u) => u.key).sort()).toEqual(["brand-new", content.words[10].word].sort());
    expect(call.args.p_removes).toEqual([{ kind: "words", key: content.words[20].word }]);
    const player = createSupabaseRepo({ userId: "u2", isAdmin: false, client: fake });
    expect((await player.loadContent()).words.map((w) => w.word)).toEqual(words.map((w) => w.word));
  });

  it("never writes content for a player", async () => {
    const fake = createFakeSupabase({ admin: false });
    const player = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await player.saveContent(content);
    expect(rpcCalls(fake, "apply_content_changes")).toHaveLength(0);
  });
});

describe("progress", () => {
  const progress = () => {
    const p = migrateProgressData(backup);
    // A restored backup carries content fields; they must never be saved as progress.
    return p;
  };

  it("saves the backup once and reloads it without the content fields", async () => {
    const fake = createFakeSupabase();
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    expect(await repo.loadProgress()).toBeNull();
    const data = progress();
    await repo.saveProgress(data);
    const stored = JSON.stringify(fake.tables.progress);
    expect(stored).not.toContain('"words"');
    expect(fake.tables.mastery.length).toBe(Object.keys(data.mastery).length);
    const again = await createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake }).loadProgress();
    expect(again.score).toBe(data.score);
    expect(again.mastery).toEqual(data.mastery);
    expect(again.activeSession).toEqual(data.activeSession);
    expect(again.words).toBeUndefined();
    expect(fake.tables.profiles[0].score).toBe(data.score);
  });

  it("sends only the changed mastery record and sections on the next save", async () => {
    const fake = createFakeSupabase();
    const repo = createSupabaseRepo({ userId: "u1", isAdmin: false, client: fake });
    await repo.loadProgress();
    const data = progress();
    await repo.saveProgress(data);
    const key = Object.keys(data.mastery)[3];
    const next = { ...data, score: data.score + 10, mastery: { ...data.mastery, [key]: { ...data.mastery[key], correct: (data.mastery[key].correct || 0) + 1 } } };
    await repo.saveProgress(next);
    const [call] = rpcCalls(fake, "save_progress").slice(-1);
    expect(Object.keys(call.args.p_mastery)).toEqual([key]);
    expect(Object.keys(call.args.p_sections)).toEqual(["core"]);
    expect(call.args.p_profile.score).toBe(data.score + 10);
    // Nothing changed: nothing sent.
    const count = rpcCalls(fake, "save_progress").length;
    await repo.saveProgress(next);
    expect(rpcCalls(fake, "save_progress")).toHaveLength(count);
  });

  it("files a player's report where the admin can see it", async () => {
    const fake = createFakeSupabase({ userId: "p1", admin: false });
    const player = createSupabaseRepo({ userId: "p1", isAdmin: false, client: fake });
    await player.loadProgress();
    const report = { id: "rep-1", prompt: "Q?", targetWords: ["Campaign"], reason: "Typo" };
    await player.saveProgress({ ...progress(), reports: [report] });
    expect(fake.tables.reports.map((r) => r.id)).toEqual(["rep-1"]);
    // The admin sees it among their reports, marked as another player's.
    fake.tables.profiles.push({ id: "a1", username: "khaled", role: "admin" });
    const admin = createSupabaseRepo({ userId: "a1", isAdmin: true, client: fake });
    const adminData = await admin.loadProgress();
    expect(adminData.reports.find((r) => r.id === "rep-1")._remote).toBe(true);
  });
});
