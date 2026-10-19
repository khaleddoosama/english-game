import { useMemo } from "react";
import { playerOf } from "./liveSetup";

// The player for Live, friends and the library, kept while the account stays the same.
export function useLivePlayer(profile) {
  return useMemo(() => playerOf(profile), [profile?.id, profile?.username]);
}
