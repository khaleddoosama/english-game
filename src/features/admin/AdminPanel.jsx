// Admin panel: analytics (overview, players, live, AI), content and
// reports with paginated tables and bulk actions, an audit log, and the
// classic tools (editor, grammar, health, settings, data) embedded as-is.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Database, Flag, HeartPulse, History, LayoutDashboard, RefreshCw, Scale, Settings, Sparkles, Swords, Users, Wrench } from "lucide-react";
import { AdminControlCenter } from "./AdminControlCenter";
import { createAdminApi } from "./adminApi";
import { RangePicker, useAsync } from "./adminUi";
import { navigate, pathFor, useLocation, useQueryParam } from "../../lib/router";
import { Overview } from "./sections/Overview";
import { Players } from "./sections/Players";
import { Words } from "./sections/Words";
import { Reports } from "./sections/Reports";
import { AiUsage, AuditLog, LiveMatches } from "./sections/Activity";
import "../../styles/admin.css";

const NAV = [
  { group: "Insights", items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard, desc: "How the game is doing" },
    { id: "players", label: "Players", icon: Users, desc: "Accounts, progress and access" },
    { id: "live", label: "Live matches", icon: Swords, desc: "Every Live Challenge played" },
    { id: "ai", label: "AI usage", icon: Sparkles, desc: "Gemini calls by day and player" },
  ] },
  { group: "Content", items: [
    { id: "words", label: "Words", icon: BookOpen, desc: "Browse, filter, fix and organise the vocabulary" },
    { id: "reports", label: "Reports", icon: Flag, desc: "Questions players flagged" },
    { id: "grammar", label: "Grammar", icon: Scale, desc: "Grammar rules and their questions", classic: "grammar" },
    { id: "editor", label: "Content editor", icon: Wrench, desc: "Edit any item, categories, stories, combos and challenges", classic: "content" },
    { id: "health", label: "Content health", icon: HeartPulse, desc: "Find and fix weak content with AI", classic: "health" },
  ] },
  { group: "System", items: [
    { id: "audit", label: "Activity log", icon: History, desc: "What changed and who changed it" },
    { id: "settings", label: "Game settings", icon: Settings, desc: "Round size, daily goal, sound", classic: "settings" },
    { id: "data", label: "Data & backup", icon: Database, desc: "Import, export, reset", classic: "data" },
  ] },
];
const ALL = NAV.flatMap((g) => g.items);
const HIDDEN = { review: { id: "review", label: "Review report", desc: "AI review, fixes and retiring flawed questions", classic: "reports" } };
const RANGES = [7, 30, 90];

function LiveSection({ api, tick, activity, range }) {
  const matches = useAsync(() => api.liveMatches(), [api, tick]);
  return <LiveMatches matches={matches} activity={activity} range={range} />;
}
function AiSection({ api, tick, activity, range, overview }) {
  const usage = useAsync(() => api.aiUsage(range), [api, tick, range]);
  return <AiUsage usage={usage} activity={activity} range={range} overview={overview} />;
}
function AuditSection({ api, tick }) {
  const audit = useAsync(() => api.audit(), [api, tick]);
  return <AuditLog audit={audit} />;
}

export function AdminPanel(props) {
  const { content, mastery, reports, profile, onClose, onUpdate, onResolveReport, onDeleteReport, route = {} } = props;
  // The page comes from the address: /admin/<section>/<item>?filters
  const section = ALL.some((x) => x.id === route.section) || HIDDEN[route.section] ? route.section : "overview";
  const item = route.item ?? null;
  const [rangeParam, setRangeParam] = useQueryParam("range", "30");
  const range = RANGES.includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const setRange = (n) => setRangeParam(String(n));
  const [tick, setTick] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState(Date.now());
  const location = useLocation();
  // Remembered so the Admin tab reopens this page with its filters.
  useEffect(() => { try { localStorage.setItem("wh-admin-path", location.href); } catch {} }, [location.href]);
  const focus = useMemo(() => (section === "review" && item ? { reportId: item } : section === "editor" && item ? (item === "new" ? { entity: "words", create: true } : { entity: "words", key: item }) : null), [section, item]);
  const local = useRef(null);
  local.current = { content, mastery, sessionLogs: props.sessionLogs, profile, reports, score: props.score, studyStreak: props.studyStreak, bestStudyStreak: props.bestStudyStreak };
  const api = useMemo(() => createAdminApi(local), []);
  const overview = useAsync(() => api.overview(), [api, tick]);
  const activity = useAsync(() => api.activity(range), [api, range, tick]);
  const players = useAsync(() => api.players(), [api, tick]);
  const wordStats = useAsync(() => api.wordStats(), [api, tick]);

  const setSection = (id, sub = null) => navigate(pathFor("admin", { section: id, item: sub }));
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // On phones the nav is a scrolling tab bar: keep the current tab in view.
    document.querySelector(".adm-side button.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [section]);
  const refresh = () => { setTick((t) => t + 1); setRefreshedAt(Date.now()); };
  const current = ALL.find((x) => x.id === section) || HIDDEN[section] || ALL[0];
  const openReports = reports.filter((r) => !r.resolvedAt).length;
  const editWord = (word) => setSection("editor", word);
  const createWord = () => setSection("editor", "new");
  const openPlayerByName = (name) => setSection("players", name);
  const showsRange = ["overview", "live", "ai"].includes(section);

  return (
    <section className="adm-shell">
      <aside className="adm-side" aria-label="Admin sections">
        <div className="adm-brand"><span>WH</span><div><b>Admin</b><small>{profile?.username || "local"}</small></div></div>
        <nav>
          {NAV.map((g) => (
            <div key={g.group} className="adm-nav-group">
              <small>{g.group}</small>
              {g.items.map(({ id, label, icon: Icon }) => (
                <button key={id} className={section === id || (section === "review" && id === "reports") ? "on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
                  <Icon size={17} /><span>{label}</span>{id === "reports" && openReports > 0 && <em>{openReports}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="adm-back" onClick={onClose}><ArrowLeft size={16} /> Back to game</button>
      </aside>
      <main className="adm-main">
        <header className="adm-top">
          <div>
            <h2>{current.label}</h2>
            <p>{current.desc}</p>
          </div>
          <div className="adm-top-actions">
            {showsRange && <RangePicker value={range} onChange={setRange} />}
            {!current.classic && <button className="adm-btn ghost" onClick={refresh} title={`Updated ${new Date(refreshedAt).toLocaleTimeString()}`}><RefreshCw size={15} className={overview.loading || activity.loading ? "spin" : ""} /> Refresh</button>}
          </div>
        </header>
        {section === "overview" && <Overview range={range} overview={overview} activity={activity} wordStats={wordStats} players={players} content={content} onOpenWord={editWord} onOpenPlayer={openPlayerByName} onNavigate={setSection} />}
        {section === "players" && <Players api={api} players={players} me={profile?.id || "local"} onChanged={refresh} openName={item} onOpen={(name) => (name ? navigate(pathFor("admin", { section: "players", item: name }) + window.location.search) : navigate(pathFor("admin", { section: "players" }) + window.location.search))} />}
        {section === "live" && <LiveSection api={api} tick={tick} activity={activity} range={range} />}
        {section === "ai" && <AiSection api={api} tick={tick} activity={activity} range={range} overview={overview} />}
        {section === "words" && <Words content={content} wordStats={wordStats} mastery={mastery} onUpdate={onUpdate} onEdit={editWord} onCreate={createWord} />}
        {section === "reports" && <Reports reports={reports} onResolve={onResolveReport} onDelete={onDeleteReport} onReview={(r) => setSection("review", r.id)} />}
        {section === "audit" && <AuditSection api={api} tick={tick} />}
        {current.classic && <div className="adm-classic">
          {section === "review" && <button className="adm-link" onClick={() => setSection("reports")}><ArrowLeft size={14} /> All reports</button>}
          <AdminControlCenter {...props} embedded tab={current.classic} focus={focus} />
        </div>}
      </main>
    </section>
  );
}
