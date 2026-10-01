import { useState } from "react";
import { useAuth } from "../../lib/auth";
import { parseRoute, useLocation } from "../../lib/router";
import { useAppSettings } from "../../lib/appSettings";

export function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState("signin"); // signin | signup
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(auth.error || null);
  // Opened from a challenge link: say so. After signing in, the same
  // address opens the challenge.
  const route = parseRoute(useLocation().path);
  const invite = route.screen === "live" && route.code ? route.code : null;
  const { signupsOpen } = useAppSettings();

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") await auth.signIn(username, password);
      else await auth.signUp(username, password);
    } catch (problem) {
      setError(problem.message || "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">Word <span>Hunter</span></h1>
        <p className="auth-sub">English vocabulary detective</p>
        {invite && <p className="auth-invite" role="status">You've been invited to a <b>Live Challenge</b> ({invite}). Sign in, or create an account in a few seconds, to join.</p>}
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
          {signupsOpen && <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setError(null); }}>Create account</button>}
        </div>
        <label className="auth-field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={20} required placeholder="e.g. sara_22" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} required />
        </label>
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {!signupsOpen && <p className="auth-hint">New accounts are closed right now. Ask the admin for an account.</p>}
        {mode === "signup" && <p className="auth-hint">Usernames are 3–20 lowercase letters, numbers or _. No email needed. Your progress is saved to your account on every device.</p>}
      </form>
    </main>
  );
}

export function Splash() {
  return (
    <main className="splash" aria-busy="true">
      <div className="splash-inner">
        <h1 className="auth-title">Word <span>Hunter</span></h1>
        <div className="splash-bar" />
      </div>
    </main>
  );
}
