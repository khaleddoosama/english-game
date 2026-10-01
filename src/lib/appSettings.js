// App-wide settings (Admin -> Settings): one JSON row in app_settings that
// everyone reads; only the admin saves (admin_save_settings validates and
// the server enforces the rules that matter). Local mode keeps them in
// localStorage. Cached so the sign-in page and an offline start have them.
import { useSyncExternalStore } from "react";
import { isLocalMode, supabase } from "./supabase";

export const APP_DEFAULTS = {
  signupsOpen: true,
  signupsPer10Min: 30,
  maintenance: false,
  maintenanceMessage: "",
  announcement: "",
  announcementTone: "info",
  aiForPlayers: true,
  aiDailyLimit: 150,
  ttsForPlayers: true,
  liveCreate: "everyone",
  liveMaxPlayers: 10,
  liveDefaultQuestions: 10,
  liveDefaultSeconds: 20,
  liveMaxHours: 168,
  leaderboard: true,
  newPlayerDefaults: { questionsPerRound: 12, newWordsPerRound: 3, dailyGoal: 20, sound: true, enablePairModes: true },
};

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
const bool = (v, d) => (typeof v === "boolean" ? v : d);

// Same rules as admin_save_settings, so the form shows what will be saved.
export function normalizeAppSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const nd = s.newPlayerDefaults && typeof s.newPlayerDefaults === "object" ? s.newPlayerDefaults : {};
  const D = APP_DEFAULTS, ND = D.newPlayerDefaults;
  return {
    signupsOpen: bool(s.signupsOpen, D.signupsOpen),
    signupsPer10Min: clamp(s.signupsPer10Min, 5, 200, D.signupsPer10Min),
    maintenance: bool(s.maintenance, D.maintenance),
    maintenanceMessage: String(s.maintenanceMessage ?? "").slice(0, 500),
    announcement: String(s.announcement ?? "").slice(0, 500),
    announcementTone: ["info", "success", "warning"].includes(s.announcementTone) ? s.announcementTone : "info",
    aiForPlayers: bool(s.aiForPlayers, D.aiForPlayers),
    aiDailyLimit: clamp(s.aiDailyLimit, 0, 2000, D.aiDailyLimit),
    ttsForPlayers: bool(s.ttsForPlayers, D.ttsForPlayers),
    liveCreate: s.liveCreate === "admin" ? "admin" : "everyone",
    liveMaxPlayers: clamp(s.liveMaxPlayers, 2, 10, D.liveMaxPlayers),
    liveDefaultQuestions: clamp(s.liveDefaultQuestions, 5, 30, D.liveDefaultQuestions),
    liveDefaultSeconds: [0, 10, 15, 20, 30, 45, 60].includes(Number(s.liveDefaultSeconds)) ? Number(s.liveDefaultSeconds) : D.liveDefaultSeconds,
    liveMaxHours: clamp(s.liveMaxHours, 1, 168, D.liveMaxHours),
    leaderboard: bool(s.leaderboard, D.leaderboard),
    newPlayerDefaults: {
      questionsPerRound: clamp(nd.questionsPerRound, 4, 30, ND.questionsPerRound),
      newWordsPerRound: clamp(nd.newWordsPerRound, 0, 10, ND.newWordsPerRound),
      dailyGoal: clamp(nd.dailyGoal, 5, 100, ND.dailyGoal),
      sound: bool(nd.sound, ND.sound),
      enablePairModes: bool(nd.enablePairModes, ND.enablePairModes),
    },
  };
}

const CACHE = "wh-app-settings";
const listeners = new Set();
let current = (() => { try { return normalizeAppSettings(JSON.parse(localStorage.getItem(CACHE) || "null")); } catch { return normalizeAppSettings(null); } })();
let loading = null;
function publish(next) {
  current = normalizeAppSettings(next);
  try { localStorage.setItem(CACHE, JSON.stringify(current)); } catch {}
  listeners.forEach((l) => l());
}

export function getAppSettings() { return current; }

export function loadAppSettings() {
  if (isLocalMode) return Promise.resolve(current);
  loading ||= (async () => {
    try {
      const { data, error } = await supabase.from("app_settings").select("data").eq("id", 1).maybeSingle();
      if (!error && data) publish(data.data);
    } catch {} // offline: the cached copy stays
    loading = null;
    return current;
  })();
  return loading;
}

export async function saveAppSettings(next) {
  const clean = normalizeAppSettings(next);
  if (isLocalMode) { publish(clean); return current; }
  const { data, error } = await supabase.rpc("admin_save_settings", { p_data: clean });
  if (error) throw new Error(error.message);
  publish(data);
  return current;
}

export function useAppSettings() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
}
