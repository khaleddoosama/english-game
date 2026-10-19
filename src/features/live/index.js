// The public surface of the Live module: the Live screen (loaded on demand), the Live API (the shell passes it to
// social for local invitations), the player, the limits of a new challenge, and the gap sentences to refresh after
// one. Docs: docs/modules/live/README.md, docs/modules/live/live-setup.md.
import { lazy } from "react";

export { getLiveApi } from "./liveApi";
export { useLivePlayer } from "./useLivePlayer";
export { gapRefreshBatch, liveLimits } from "./liveSetup";
export const LiveChallenge = lazy(() => import("./LiveChallenge").then((m) => ({ default: m.LiveChallenge })));
