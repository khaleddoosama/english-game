// Log out: finish any save first (up to 5 s), so the last answers and edits aren't lost with the session. Docs:
// docs/modules/accounts/sign-in.md.
import { useState } from "react";
import { SIGN_OUT_WAIT_MS, signOutFailedText } from "./authRules";

// onSignOut   the account's sign-out (none in local mode: then nothing happens)
// saves       { pendingSavesRef, runningSavesRef }: the shell's save queue (waiting saves, and the promises of running ones)
// setToast    shows why a sign-out failed
export function useSignOut({ onSignOut, saves, setToast }) {
  const { pendingSavesRef, runningSavesRef } = saves;
  const [loggingOut, setLoggingOut] = useState(false);
  async function logOut() {
    if (!onSignOut || loggingOut) return;
    setLoggingOut(true);
    Object.values(pendingSavesRef.current).forEach((run) => run());
    await Promise.race([Promise.allSettled(Object.values(runningSavesRef.current)), new Promise((r) => setTimeout(r, SIGN_OUT_WAIT_MS))]);
    try { await onSignOut(); } catch (e) { setLoggingOut(false); setToast({ text: signOutFailedText(e) }); }
  }
  return { loggingOut, logOut };
}
