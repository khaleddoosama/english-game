import { createContext, useContext, useEffect, useState } from "react";
import { USERNAME_RE, emailFor, isLocalMode, supabase } from "./supabase";

const AuthContext = createContext(null);
const LOCAL_PROFILE = { id: "local", username: "local", role: "admin" };
const profileCacheKey = (id) => `wh-profile:${id}`;

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
        if (!stopped && currentId === id) setState({ loading: false, user: null, profile: null, error: "Couldn't load your account. Check your connection and try again." });
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
      const name = String(username || "").trim().toLowerCase();
      if (!USERNAME_RE.test(name)) throw new Error("Usernames are 3–20 letters, numbers or _.");
      const { error } = await supabase.auth.signInWithPassword({ email: emailFor(name), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong username or password." : error.message);
    },
    async signUp(username, password) {
      const name = String(username || "").trim().toLowerCase();
      if (!USERNAME_RE.test(name)) throw new Error("Usernames are 3–20 letters, numbers or _.");
      if (String(password || "").length < 6) throw new Error("Passwords need at least 6 characters.");
      const { error } = await supabase.rpc("register_player", { p_username: name, p_password: password });
      if (error) throw new Error(error.message);
      await api.signIn(name, password);
    },
    async signOut() {
      if (isLocalMode) return;
      await supabase.auth.signOut();
    },
    async changePassword(password) {
      if (String(password || "").length < 6) throw new Error("Passwords need at least 6 characters.");
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

// Access token for calls to our own /api functions.
export async function accessToken() {
  if (isLocalMode) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
