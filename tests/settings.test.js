import { describe, expect, it } from "vitest";
import { APP_DEFAULTS, normalizeAppSettings } from "../src/lib/appSettings.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/engine/progress.js";

describe("app settings", () => {
  it("fills defaults for a fresh install", () => {
    expect(normalizeAppSettings(null)).toEqual(APP_DEFAULTS);
    expect(normalizeAppSettings({})).toEqual(APP_DEFAULTS);
  });
  it("clamps and cleans values the same way the server does", () => {
    const s = normalizeAppSettings({ aiDailyLimit: 99999, liveMaxPlayers: 40, liveDefaultSeconds: 17, liveMaxHours: 0, announcementTone: "loud", liveCreate: "nobody", signupsOpen: "no", newPlayerDefaults: { questionsPerRound: 99, dailyGoal: 1, sound: false } });
    expect(s.aiDailyLimit).toBe(2000);
    expect(s.liveMaxPlayers).toBe(10);
    expect(s.liveDefaultSeconds).toBe(20);
    expect(s.liveMaxHours).toBe(1);
    expect(s.announcementTone).toBe("info");
    expect(s.liveCreate).toBe("everyone");
    expect(s.signupsOpen).toBe(true); // only real booleans count
    expect(normalizeAppSettings({ signupsPer10Min: 9999 }).signupsPer10Min).toBe(200);
    expect(normalizeAppSettings({ signupsPer10Min: 1 }).signupsPer10Min).toBe(5);
    expect(s.newPlayerDefaults).toEqual({ questionsPerRound: 30, newWordsPerRound: 3, dailyGoal: 5, sound: false, enablePairModes: true });
  });
  it("keeps texts short", () => {
    expect(normalizeAppSettings({ announcement: "x".repeat(900) }).announcement).toHaveLength(500);
  });
});

describe("player settings", () => {
  it("defaults new options", () => {
    const s = normalizeSettings({});
    expect(s).toMatchObject({ autoAdvanceMs: 0, hints: true, speakWord: false, speedSeconds: 60, textSize: "normal", shortcuts: true, reduceMotion: false, liveQuestions: null, liveSeconds: null });
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
  it("accepts only known choices", () => {
    const s = normalizeSettings({ autoAdvanceMs: 1500, speedSeconds: 5, textSize: "huge", liveQuestions: 7, liveSeconds: 0, hints: false, shortcuts: false });
    expect(s.autoAdvanceMs).toBe(0);
    expect(s.speedSeconds).toBe(60);
    expect(s.textSize).toBe("normal");
    expect(s.liveQuestions).toBeNull();
    expect(s.liveSeconds).toBe(0); // "no limit" is a real choice
    expect(s.hints).toBe(false);
    expect(s.shortcuts).toBe(false);
    expect(normalizeSettings({ autoAdvanceMs: 2000, textSize: "xlarge", speedSeconds: 90 })).toMatchObject({ autoAdvanceMs: 2000, textSize: "xlarge", speedSeconds: 90 });
  });
  it("keeps older saved settings working", () => {
    const old = { questionsPerRound: 20, newWordsPerRound: 0, weakReviewSize: 8, enablePairModes: false, sound: false, dailyGoal: 40, levelView: "group" };
    expect(normalizeSettings(old)).toMatchObject(old);
  });
});
