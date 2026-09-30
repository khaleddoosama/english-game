import { useEffect, useState } from "react";
import { Cloud, CloudOff, Home, ListChecks, Loader2, Trophy, TriangleAlert, User, Users } from "lucide-react";

// Fixed bottom navigation: the game's main places, one tap away on a phone.
export function BottomNav({ screen, onNavigate, isAdmin }) {
  const items = [
    { id: "levels", label: "Home", icon: Home },
    { id: "live", label: "Live", icon: Users },
    { id: "leaderboard", label: "Ranks", icon: Trophy },
    { id: "profile", label: "Profile", icon: User },
    ...(isAdmin ? [{ id: "admin", label: "Admin", icon: ListChecks }] : []),
  ];
  return (
    <nav className="ui-bottom-nav" aria-label="Main">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={screen === id ? "active" : ""} aria-current={screen === id ? "page" : undefined} onClick={() => onNavigate(id)}>
          <Icon size={20} strokeWidth={screen === id ? 2.4 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// Save status from the repo, plus the browser's online state.
export function SyncStatus({ repo }) {
  const [status, setStatus] = useState(repo.status.get());
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => repo.status.subscribe(setStatus), [repo]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (repo.mode === "local") return null;
  const view = !online || status === "offline"
    ? { icon: CloudOff, text: "Offline · saved on this device", cls: "warn" }
    : status === "error" ? { icon: TriangleAlert, text: "Not saved yet · retrying", cls: "bad" }
    : status === "saving" ? { icon: Loader2, text: "Saving…", cls: "busy" }
    : { icon: Cloud, text: "Saved", cls: "ok" };
  const Icon = view.icon;
  return <span className={`ui-sync ${view.cls}`} role="status" title={view.text}><Icon size={13} /><span>{view.text}</span></span>;
}

export function ScreenSkeleton() {
  return <div className="ui-page" aria-busy="true"><div className="ui-skeleton-row" /><div className="ui-skeleton-row" /><div className="ui-skeleton-row short" /></div>;
}
