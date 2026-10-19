// The sign-in state for the whole app: the session, the profile (cached for an offline start), and the account
// actions. The rules with no state are in authRules.js. Docs: docs/modules/accounts/sign-in.md.
import { createContext, useContext, useEffect, useState } from "react";
import { isLocalMode, supabase } from "../../lib/supabase";
import { LOCAL_PROFILE, PROFILE_LOAD_ERROR, cleanUsername, emailFor, passwordProblem, profileCacheKey, signInErrorText, usernameProblem } from "./authRules";

const AuthContext = createContext(null);

async function fetchProfile(userId) {
  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) throw error;
    try { localStorage.setItem(profileCacheKey(userId), JSON.stringify(data)); } catch (_) {}
    return data;
  } catch (e) {
    // Offline start: the last known profile keeps the game playable.
    try { const cached = localStorage.getItem(profileCacheKey(userId)); if (cached) return JSON.parse(cached); } catch (_) {}
    throw e;
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, profile: null, error: null });

  useEffect(() => {
    if (isLocalMode) { setState({ loading: false, user: { id: "local" }, profile: LOCAL_PROFILE, error: null }); return; }
    // undefined, not null: a signed-out first visit (session null) must still
    // count as a change, or the splash screen never goes away.
    let currentId, stopped = false;
    const apply = async (session) => {
      const id = session?.user?.id || null;
      if (id === currentId) return; // token refreshes don't touch the game
      currentId = id;
      if (!id) { if (!stopped) setState({ loading: false, user: null, profile: null, error: null }); return; }
      try {
        const profile = await fetchProfile(id);
        if (!stopped && currentId === id) setState({ loading: false, user: session.user, profile, error: null });
      } catch (e) {
        if (!stopped && currentId === id) setState({ loading: false, user: null, profile: null, error: PROFILE_LOAD_ERROR });
      }
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    // Supabase warns against awaiting its own calls inside this callback.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { setTimeout(() => apply(session), 0); });
    return () => { stopped = true; sub.subscription.unsubscribe(); };
  }, []);

  const api = {
    ...state,
    isAdmin: state.profile?.role === "admin",
    async signIn(username, password) {
      const name = cleanUsername(username);
      const problem = usernameProblem(name);
      if (problem) throw new Error(problem);
      const { error } = await supabase.auth.signInWithPassword({ email: emailFor(name), password });
      if (error) throw new Error(signInErrorText(error.message));
    },
    async signUp(username, password) {
      const name = cleanUsername(username);
      const problem = usernameProblem(name) || passwordProblem(password);
      if (problem) throw new Error(problem);
      const { error } = await supabase.rpc("register_player", { p_username: name, p_password: password });
      if (error) throw new Error(error.message);
      await api.signIn(name, password);
    },
    async signOut() {
      if (isLocalMode) return;
      await supabase.auth.signOut();
    },
    async changePassword(password) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },
    async refreshProfile() {
      if (isLocalMode || !state.user) return;
      const profile = await fetchProfile(state.user.id);
      setState((s) => ({ ...s, profile }));
    },
  };
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
