// Live Challenge results and rematch on the local backend (the same rules as
// supabase/tests/live_review.sql): every player's answers once the challenge
// is over and never before; the rematch link on the old challenge; and the
// settings "Retry challenge" carries into the new-challenge form.
import { describe, expect, it } from "vitest";
import { createLocalLiveApi } from "../src/features/live/liveApi.js";
import { liveAutoTitle, retryDefaults } from "../src/features/live/liveEngine.js";

const Q = (answer) => ({ mode: "meaning", prompt: `p-${answer}`, options: ["Apple", "Bread", "Cheese"], answer, word: answer.toLowerCase(), explanation: `about ${answer}`, sentences: [] });
const QS = [Q("Apple"), Q("Bread"), Q("Cheese")];
const SETTINGS = { lesson: "Health", unit: "Pills", kinds: ["meaning", "gap"], reveal: false, requested: 15 };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
function world() {
  const storage = memoryStorage();
  let t = Date.parse("2026-10-01T10:00:00Z");
  const as = (id) => createLocalLiveApi({ storage, me: () => ({ id, name: id }), now: () => t, clock: () => t });
  return { as, tick: (ms) => { t += ms; } };
}
async function play(w, api, code, choices) {
  await api.begin(code);
  for (let i = 0; i < choices.length; i++) { w.tick(600); await api.answer(code, i, choices[i], 600); }
}
const fails = async (promise, status) => { let error; try { await promise; } catch (e) { error = e; } expect(error?.code, error?.message).toBe(status); };

// A finished two-player challenge: the guest gets the first one wrong.
async function finished(settings = SETTINGS) {
  const w = world(), host = w.as("host"), guest = w.as("guest"), stranger = w.as("stranger");
  const code = await host.create({ title: "Review", seconds: 20, maxPlayers: 2, startMode: "together", settings, questions: QS });
  await guest.join(code);
  await host.start(code);
  await play(w, guest, code, ["Bread", "Bread", "Cheese"]);
  return { w, host, guest, stranger, code, finish: () => play(w, host, code, ["Apple", "Bread", "Cheese"]) };
}

describe("everyone's answers", () => {
  it("nobody sees an opponent's choices while the challenge is running", async () => {
    const { host, guest, code } = await finished();
    expect((await guest.view(code)).all_answers).toBeNull(); // the guest has finished; the host hasn't
    expect((await host.view(code)).all_answers).toBeNull();
  });

  it("once it is over, every member sees every player's answers, wrong ones included", async () => {
    const { host, guest, code, finish } = await finished();
    await finish();
    for (const api of [host, guest]) {
      const v = await api.view(code);
      expect(v.state).toBe("done");
      expect(v.all_answers).toHaveLength(6);
      const g = v.all_answers.filter((a) => a.user_id === "guest");
      expect(g.map((a) => [a.idx, a.choice, a.correct])).toEqual([[0, "Bread", false], [1, "Bread", true], [2, "Cheese", true]]);
      expect(v.all_answers.filter((a) => a.user_id === "host").every((a) => a.correct)).toBe(true);
      expect(v.all_answers.every((a) => typeof a.ms === "number")).toBe(true);
    }
  });

  it("someone who wasn't in it sees no answers, key or questions", async () => {
    const { stranger, code, finish } = await finished();
    await finish();
    const v = await stranger.view(code);
    expect(v.member).toBe(false);
    expect(v.all_answers).toBeNull();
    expect(v.my_answers).toBeNull();
    expect(v.key).toBeNull();
    expect(v.questions).toBeNull();
  });
});

describe("rematch link", () => {
  it("only a member who made the new challenge can link it, and only after the end", async () => {
    const { w, host, guest, stranger, code, finish } = await finished();
    const next = await host.create({ title: "Again", seconds: 20, maxPlayers: 2, startMode: "together", settings: {}, questions: QS });
    await fails(host.setNext(code, next), "55000");              // still running
    await finish();
    await fails(host.setNext(code, code), "22023");              // itself
    await fails(host.setNext(code, "ZZZZZZ"), "42501");          // not a challenge
    await fails(stranger.setNext(code, next), "42501");          // wasn't in it
    await fails(guest.setNext(code, next), "42501");             // someone else's new challenge
    expect((await host.view(code)).settings.next_code).toBeUndefined();
    await host.setNext(code, next);
    const v = await guest.view(code);
    expect(v.settings.next_code).toBe(next);
    expect(v.settings.next_by).toBe("host");
    expect(v.settings.lesson).toBe("Health"); // merged, not replaced
    expect(w).toBeTruthy();
  });

  it("is shown to the players only, and the first link wins", async () => {
    const { host, guest, stranger, code, finish } = await finished();
    await finish();
    const first = await host.create({ title: "A", seconds: 20, maxPlayers: 2, startMode: "together", settings: {}, questions: QS });
    const second = await guest.create({ title: "B", seconds: 20, maxPlayers: 2, startMode: "together", settings: {}, questions: QS });
    await host.setNext(code, first);
    await guest.setNext(code, second); // not an error, and doesn't replace it
    expect((await guest.view(code)).settings.next_code).toBe(first);
    const outsider = (await stranger.view(code)).settings;
    expect(outsider).not.toHaveProperty("next_code");
    expect(outsider).not.toHaveProperty("next_by");
    expect(outsider.lesson).toBe("Health");
  });
});

describe("retry defaults", () => {
  const word = (units) => ({ kind: "word", obj: { word: "w", units } });
  const levels = [{ title: "Food", items: [word(["Fruit"])] }, { title: "Health", items: [word(["Pills"]), word(["Doctor"])] }];
  const view = (over = {}) => ({ code: "ABC123", title: "Health · Pills", seconds: 15, max_players: 4, start_mode: "anytime", question_count: 12, settings: { ...SETTINGS }, ...over });

  it("turns the old settings into the form's values", () => {
    expect(retryDefaults(view(), levels)).toEqual({
      from: "ABC123", sourceTitle: "Health · Pills", lesson: "1", unit: "Pills", count: 15, seconds: 15, maxPlayers: 4, startMode: "anytime",
      kinds: ["meaning", "gap"], reveal: false, title: "",
    });
  });

  it("keeps a name the creator typed, but lets the automatic one follow the lesson", () => {
    expect(retryDefaults(view({ title: "Friday duel" }), levels).title).toBe("Friday duel");
    expect(retryDefaults(view({ title: "Health · Pills" }), levels).title).toBe("");
    expect(liveAutoTitle(levels[1], [{ id: "Pills", title: "Pills" }], "Pills")).toBe("Health · Pills");
    expect(liveAutoTitle(null, [], "")).toBe("Mixed lessons");
  });

  it("drops what no longer exists", () => {
    const d = retryDefaults(view({ settings: { lesson: "Deleted lesson", unit: "Pills", kinds: ["nope"] } }), levels);
    expect(d).toMatchObject({ lesson: "all", unit: "", kinds: null, reveal: true });
    expect(retryDefaults(view({ settings: { lesson: "Health", unit: "Gone", kinds: ["meaning"] } }), levels)).toMatchObject({ lesson: "1", unit: "" });
  });

  it("works for a challenge made before settings were stored", () => {
    const d = retryDefaults(view({ settings: {}, question_count: 10 }), levels);
    expect(d).toMatchObject({ lesson: "all", unit: "", count: 10, kinds: null, reveal: true });
  });
});
