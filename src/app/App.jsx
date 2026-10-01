import { useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "../lib/auth";
import { isLocalMode } from "../lib/supabase";
import { createLocalRepo, createSupabaseRepo } from "../lib/repo";
import { LoginPage, Splash } from "../features/auth/LoginPage";
import WordHunter from "./WordHunter";
import { loadAppSettings } from "../lib/appSettings";

// App-wide settings (sign-ups, maintenance, announcement…) load once at
// start; the cached copy is used meanwhile and offline.
loadAppSettings();

function Game({ user, profile }) {
  const isAdmin = profile?.role === "admin";
  const repo = useMemo(
    () => (isLocalMode ? createLocalRepo() : createSupabaseRepo({ userId: user.id, isAdmin })),
    [user.id, isAdmin],
  );
  useEffect(() => () => repo.dispose(), [repo]);
  return <WordHunter repo={repo} profile={profile} isAdmin={isAdmin} />;
}

function Gate() {
  const { loading, user, profile } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <LoginPage />;
  // Keyed by account: signing in as someone else starts a fresh game state.
  return <Game key={user.id} user={user} profile={profile} />;
}

export default function App() {
  return <AuthProvider><Gate /></AuthProvider>;
}
