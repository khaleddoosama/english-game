// The Profile page's "Change password" form (online only). Docs: docs/modules/accounts/sign-in.md.
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "./AuthProvider";

export function ChangePassword() {
  const auth = useAuth();
  const [pw, setPw] = useState("");
  const [pwState, setPwState] = useState(null); // null | busy | done | error text

  async function changePassword(e) {
    e.preventDefault();
    setPwState("busy");
    try { await auth.changePassword(pw); setPw(""); setPwState("done"); }
    catch (problem) { setPwState(problem.message); }
  }

  return <>
    <h3 className="ui-section-title"><KeyRound size={16} /> Change password</h3>
    <form className="ui-inline-form" onSubmit={changePassword}>
      <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setPwState(null); }} minLength={6} placeholder="New password (6+ characters)" autoComplete="new-password" />
      <button className="ui-row-btn" disabled={pwState === "busy" || pw.length < 6}>{pwState === "busy" ? "Saving…" : "Save"}</button>
    </form>
    {pwState === "done" && <p className="ui-ok">Password changed.</p>}
    {pwState && !["busy", "done"].includes(pwState) && <p className="wh-import-error">{pwState}</p>}
  </>;
}
