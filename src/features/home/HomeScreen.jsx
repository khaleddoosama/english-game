import { CheckCircle2, Play, Target, Users, X, Zap } from "lucide-react";
import { V2 } from "../../engine/v2";
import { courseLevelGroups } from "../../engine/data";
import CourseLevelsView from "./CourseLevelsView";
import HomeTabs from "./HomeTabs";
import LessonsView from "./LessonsView";
import { goalView, speedCard, storyList } from "./homeState";

// Home (/ and /stories): what to play next. The admin's announcement and the fresh-copy notice; the Practice and
// Stories sections; Resume; today's goal; the stories; the Speed Round and Live cards; the view tabs and the open view
// (Gateway, By lesson, or one of my views). It only shows what it is given and calls back; starting a round is
// features/practice. Docs: docs/modules/practice/home.md.
//   notices   { announcement: { text, tone } | null, onHideAnnouncement, freshCopy, onOpenData, onDismissFresh }
//   section   "practice" | "stories"; onSection(id)
//   resume    { session | null, onResume }
//   goal      { today: { answered, correct }, goal }
//   stories   { stories, words, mastery, solved, builder (the admin's story builder), onOpen(story) }
//   speed     { mastered, min, bestScore, bestCombo, onPlay }; onLive()
//   views     { show, tabs, active, onSelect, onNew, onCatalog, waiting, skeleton, course, myViews, lessons }:
//             course { words, grammar, keys, limited, mastery, onPlay, onStartLevel }, myViews a node (or null),
//             lessons the LessonsView props (or null)
export default function HomeScreen({ notices, section, onSection, resume, goal, stories, speed, onLive, views }) {
  const practice = section === "practice";
  return (
    <>
      {notices.announcement && <div className={`wh-announcement ${notices.announcement.tone}`} role="status"><p>{notices.announcement.text}</p><button aria-label="Hide this message" onClick={notices.onHideAnnouncement}><X size={15} /></button></div>}
      {notices.freshCopy && <div className="wh-fresh-copy-banner">
        <p><b>Fresh copy detected.</b> No saved progress or content found here — if you have a backup from a previous version, restore it now before you start playing.</p>
        <div className="wh-regen-actions">
          <button className="wh-level-btn" onClick={notices.onOpenData}>Open Import &amp; Export</button>
          <button className="wh-back-btn wh-nav-btn" onClick={notices.onDismissFresh}>Dismiss</button>
        </div>
      </div>}
      <nav className="wh-v2-nav" aria-label="Game sections">{[["practice", "Practice"], ["stories", "Stories"]].map(([id, label]) => <button key={id} aria-pressed={section === id} onClick={() => onSection(id)}>{label}</button>)}</nav>
      {resume.session && !resume.session.completed && <button className="wh-level-btn" onClick={resume.onResume}>Resume {resume.session.title} ({Math.min(resume.session.index + 1, resume.session.queue.length)}/{resume.session.queue.length})</button>}
      {practice && <Goal {...goalView(goal.today, goal.goal)} />}
      {section === "stories" && <div className="wh-panel"><h2>Stories</h2>
        {stories.builder}
        {!stories.stories.length && <p>No authored stories loaded. Import a Content v2 file to add them.</p>}
        {storyList(stories.stories, stories.words, stories.mastery, stories.solved, V2.findWord, V2.known).map(({ story, fresh, record }) => (
          <article className="wh-v2-learn" key={story.id}>
            <strong>{story.title}{record && <span className="wh-story-solved-flag"><CheckCircle2 size={13} /> Solved · {record.correct}/{record.total}</span>}</strong>
            <p>{story.questions.length}{story.grammarQuestions?.length ? ` + ${story.grammarQuestions.length} grammar` : ""} questions · {fresh ? `${fresh} new words: preview first` : "Ready for review"}</p>
            <button className="wh-level-btn" onClick={() => stories.onOpen(story)}>{record ? "Play again" : "Open story"}</button>
          </article>
        ))}
      </div>}
      {practice && <SpeedCard {...speed} />}
      {practice && (
        <div className="wh-speed-card wh-live-card">
          <div className="wh-speed-card-icon"><Users size={22} /></div>
          <div className="wh-speed-card-info">
            <div className="wh-speed-card-title">Live Challenge</div>
            <div className="wh-speed-card-meta">Send a link to 1–9 friends · same questions, everyone at their own pace</div>
          </div>
          <button className="wh-speed-card-btn" onClick={onLive}><Play size={13} /> Play</button>
        </div>
      )}
      {practice && <Views {...views} />}
    </>
  );
}

function Goal({ done, answered, goal, accuracy, width, bonus }) {
  return (
    <div className={`wh-daily-goal ${done ? "done" : ""}`}>
      <div className="wh-daily-goal-head"><b>{done ? <><CheckCircle2 size={15} /> Daily goal reached</> : <><Target size={15} /> Today's goal</>}</b><span>{answered} / {goal} questions{accuracy !== null ? ` · ${accuracy}% correct` : ""}</span></div>
      <div className="wh-daily-goal-bar"><span style={{ width: `${width}%` }} /></div>
      {bonus > 0 && <small>+{bonus} bonus questions today</small>}
    </div>
  );
}

function SpeedCard({ mastered, min, bestScore, bestCombo, onPlay }) {
  const card = speedCard(mastered, min, bestScore, bestCombo);
  return (
    <div className={`wh-speed-card ${card.locked ? "locked" : ""}`}>
      <div className="wh-speed-card-icon"><Zap size={22} /></div>
      <div className="wh-speed-card-info">
        <div className="wh-speed-card-title">Speed Round</div>
        <div className="wh-speed-card-meta">{card.text}</div>
      </div>
      <button className="wh-speed-card-btn" disabled={card.locked} onClick={onPlay}><Play size={13} /> Play</button>
    </div>
  );
}

function Views({ show, tabs, active, onSelect, onNew, onCatalog, libraryReady, waiting, skeleton, course, myViews, lessons }) {
  return (
    <>
      {show && <HomeTabs tabs={tabs} active={active} libraryReady={libraryReady} onSelect={onSelect} onNew={onNew} onCatalog={onCatalog} />}
      {/* Gateway (admin): the course's levels (A1.2 …) from every lesson, each split into its sessions. */}
      {waiting && (active === "course" || active === "lesson") && skeleton}
      {!waiting && active === "course" && (() => {
        const { levels, none } = course.limited ? courseLevelGroups(course.words.filter((w) => course.keys.words.has(w.word)), course.grammar.filter((g) => course.keys.rules.has(g.id))) : courseLevelGroups(course.words, course.grammar);
        return <CourseLevelsView levels={levels} none={none} mastery={course.mastery} limited={course.limited} onPlay={course.onPlay} onStartLevel={course.onStartLevel} />;
      })()}
      {/* My views: read only. Editing happens in the library page (Profile › My library). */}
      {myViews}
      {!waiting && active === "lesson" && lessons && <LessonsView {...lessons} />}
    </>
  );
}
