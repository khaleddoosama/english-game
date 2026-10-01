// Admin panel: analytics (overview, players, live, AI), content and
// reports with paginated tables and bulk actions, an audit log, and the
// classic tools (editor, grammar, health, settings, data) embedded as-is.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ShieldCheck, BookOpen, Database, Flag, HeartPulse, History, LayoutDashboard, RefreshCw, Scale, Settings, Sparkles, Swords, Users, Wrench } from "lucide-react";
import { AdminControlCenter } from "./AdminControlCenter";
import { createAdminApi } from "./adminApi";
import { RangePicker, useAsync } from "./adminUi";
import { navigate, pathFor, useLocation, useQueryParam } from "../../lib/router";
import { Overview } from "./sections/Overview";
import { Players } from "./sections/Players";
import { Words } from "./sections/Words";
import { Reports } from "./sections/Reports";
import { AiUsage, LiveMatches } from "./sections/Activity";
import { AuditLog } from "./sections/AuditLog";
import { DataQuality } from "./sections/DataQuality";
import { AppSettings } from "./sections/AppSettings";
import "../../styles/admin.css";

const NAV = [
  { group: "Insights", items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard, desc: "How the game is doing" },
    { id: "players", label: "Players", icon: Users, desc: "Accounts, progress and access" },
    { id: "live", label: "Live challenges", icon: Swords, desc: "Open challenges and every finished match" },
    { id: "ai", label: "AI usage", icon: Sparkles, desc: "Gemini calls by day and player" },
  ] },
  { group: "Content", items: [
    { id: "words", label: "Words", icon: BookOpen, desc: "Browse, filter, fix and organise the vocabulary" },
    { id: "reports", label: "Reports", icon: Flag, desc: "Questions players flagged" },
    { id: "grammar", label: "Grammar", icon: Scale, desc: "Grammar rules and their questions", classic: "grammar" },
    { id: "editor", label: "Content editor", icon: Wrench, desc: "Edit any item, categories, stories, combos and challenges", classic: "content" },
    { id: "quality", label: "Data quality", icon: ShieldCheck, desc: "Problems in the data, word completeness and accuracy by type" },
    { id: "health", label: "Content health", icon: HeartPulse, desc: "Find and fix weak content with AI", classic: "health" },
  ] },
  { group: "System", items: [
    { id: "audit", label: "Activity log", icon: History, desc: "Every change: who, when, which item, and each field before and after" },
    { id: "settings", label: "Settings", icon: Settings, desc: "Rules for the whole app: access, announcement, AI, Live Challenge, leaderboard, new players" },
    { id: "data", label: "Data & backup", icon: Database, desc: "Import, export, reset", classic: "data" },
  ] },
];
const ALL = NAV.flatMap((g) => g.items);
const HIDDEN = {};
const RANGES = [7, 30, 90];

function LiveSection({ api, tick, activity, range }) {
  const [n, setN] = useState(0);
  const matches = useAsync(() => api.liveMatches(), [api, tick, n]);
  const challenges = useAsync(() => api.liveChallenges(), [api, tick, n]);
  const end = async (code) => { if (!window.confirm(`End challenge ${code} now? Players who started get their results.`)) return; try { await api.endChallenge(code); setN((x) => x + 1); } catch (e) { window.alert(e.message); } };
  return <LiveMatches matches={matches} challenges={challenges} activity={activity} range={range} onEnd={end} />;
}
function AiSection({ api, tick, activity, range, overview }) {
  const usage = useAsync(() => api.aiUsage(range), [api, tick, range]);
  return <AiUsage usage={usage} activity={activity} range={range} overview={overview} />;
}

export function AdminPanel(props) {
  const { content, mastery, reports, profile, onClose, onUpdate, onResolveReport, onReopenReport, onDeleteReport, onReviewReport, onRetireVariant, route = {} } = props;
  // Old links to the report review page now open the report itself.
  useEffect(() => { if (route.section === "review") navigate(pathFor("admin", { section: "reports", item: route.item }), { replace: true }); }, [route.section]);
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
  const focus = useMemo(() => (section === "editor" && item ? (item === "new" ? { entity: "words", create: true } : { entity: "words", key: item }) : null), [section, item]);
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
                <button key={id} className={section === id ? "on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
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
            {!current.classic && section !== "settings" && <button className="adm-btn ghost" onClick={refresh} title={`Updated ${new Date(refreshedAt).toLocaleTimeString()}`}><RefreshCw size={15} className={overview.loading || activity.loading ? "spin" : ""} /> Refresh</button>}
          </div>
        </header>
        {section === "overview" && <Overview range={range} overview={overview} activity={activity} wordStats={wordStats} players={players} content={content} onOpenWord={editWord} onOpenPlayer={openPlayerByName} onNavigate={setSection} />}
        {section === "players" && <Players api={api} players={players} me={profile?.id || "local"} onChanged={refresh} openName={item} onOpen={(name) => (name ? navigate(pathFor("admin", { section: "players", item: name }) + window.location.search) : navigate(pathFor("admin", { section: "players" }) + window.location.search))} />}
        {section === "live" && <LiveSection api={api} tick={tick} activity={activity} range={range} />}
        {section === "ai" && <AiSection api={api} tick={tick} activity={activity} range={range} overview={overview} />}
        {section === "words" && <Words content={content} wordStats={wordStats} mastery={mastery} onUpdate={onUpdate} onEdit={editWord} onCreate={createWord} />}
        {section === "reports" && <Reports reports={reports} content={content} onResolve={onResolveReport} onReopen={onReopenReport} onDelete={onDeleteReport} onRetire={onRetireVariant} onReviewReport={onReviewReport} onUpdate={onUpdate}
          openKey={item} onOpen={(key) => navigate(pathFor("admin", { section: "reports", item: key }) + window.location.search)} onOpenWord={editWord} onOpenPlayer={openPlayerByName} />}
        {section === "settings" && <AppSettings />}
        {section === "quality" && <DataQuality api={api} tick={tick} onOpenWord={editWord} onOpenReport={(id) => setSection("reports", id)} onOpenPlayer={openPlayerByName} onNavigate={setSection} />}
        {section === "audit" && <AuditLog api={api} tick={tick} content={content} onUpdate={onUpdate} players={players} onOpenWord={editWord} onOpenReport={(id) => setSection("reports", id)} onOpenPlayer={openPlayerByName} />}
        {current.classic && <div className="adm-classic">
          <AdminControlCenter {...props} embedded tab={current.classic} focus={focus} />
        </div>}
      </main>
    </section>
  );
}
