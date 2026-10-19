// The public surface of the social module: the friends API and the badge counts for the shell, when Ranks is shown,
// the add-friend button (Live's results use it), the local friends answers for the library, and the three screens
// (each loads on demand). Docs: docs/modules/social/friends-and-ranks.md.
import { lazy } from "react";

export { useSocial } from "./useSocial";
export { ranksShown, ranksHiddenFromPlayers } from "./socialRules";
export { AddFriendButton, useFriendStatus } from "./AddFriendButton";
export { LOCAL_PEOPLE } from "./friendsApi";
export const FriendsPage = lazy(() => import("./FriendsPage"));
export const Leaderboard = lazy(() => import("./Leaderboard"));
export const ProfilePage = lazy(() => import("./ProfilePage"));
