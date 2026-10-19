// Before and around a challenge, no React: who plays (a player per tab in local mode), the limits and defaults of a
// new challenge, and which words have read all their gap sentences. Docs: docs/modules/live/live-setup.md.
import { V2 } from "../../engine/v2";

export const TAB_PLAYER_KEY = "wh-live-player";

// Local mode (no accounts): each browser tab is its own player, kept for the
// tab's life so a refresh doesn't turn you into someone else.
export function tabPlayer(storage = () => sessionStorage, random = Math.random) {
  try {
    const saved = JSON.parse(storage().getItem(TAB_PLAYER_KEY) || "null");
    if (saved?.id) return saved;
  } catch {}
  const p = { id: `tab-${random().toString(36).slice(2, 8)}`, name: `Player ${Math.floor(random() * 90 + 10)}` };
  try { storage().setItem(TAB_PLAYER_KEY, JSON.stringify(p)); } catch {}
  return p;
}

// The player in Live, friends and the library: the account, or the tab's player in local mode.
export const playerOf = (profile, tab = tabPlayer) => (profile && profile.id !== "local" ? { id: profile.id, name: profile.username } : tab());

// The limits and defaults of a new challenge: the admin is not held to the app's limits; the player's own
// settings choose the defaults before the app's.
export const liveLimits = (app, settings, isAdmin) => ({
  maxPlayers: isAdmin ? 10 : app.liveMaxPlayers,
  canCreate: isAdmin || app.liveCreate !== "admin",
  defaultCount: settings.liveQuestions ?? app.liveDefaultQuestions,
  defaultSeconds: settings.liveSeconds ?? app.liveDefaultSeconds,
  maxHours: isAdmin ? 168 : app.liveMaxHours,
});

// After a challenge is made: the words whose gap sentences have all been read recently get new ones written in the
// background (at most 8), for the next matches. Returns the requests for pool generation.
export const GAP_REFRESH_MAX = 8;
export const gapRefreshBatch = (words, pools, seen) => words
  .filter((w) => /_{2,}/.test(w.gap || "") && V2.poolItems(w, "gap", pools?.[w.word]?.gap).every((it) => V2.seenRecently(seen, it.text)))
  .slice(0, GAP_REFRESH_MAX)
  .map((w) => ({ word: w.word, poolType: "gap" }));
