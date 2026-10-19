import { useMemo } from "react";
import { getFriendsApi } from "./friendsApi";
import { useSocialCounts } from "./useSocialCounts";
import { navBadges } from "./socialRules";

// What the shell needs from social: the friends API for this player, the waiting counts and the navigation badges.
// `liveFor(me)` gives the Live API (local mode looks at challenges through it); the app passes it in, so this module
// does not import Live. `enabled`: count only once the game has loaded.
export function useSocial({ player, enabled, liveFor }) {
  const friendsApi = useMemo(() => getFriendsApi(() => player, liveFor), [player, liveFor]);
  const { counts, refresh } = useSocialCounts(friendsApi, enabled);
  return { friendsApi, counts, refresh, badges: navBadges(counts) };
}
