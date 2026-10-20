// What Home shows, decided without any screen: which tab is open, which tabs
// exist, and what a player who only sees their own library is shown.

// The Home tab setting is "lesson", "course" (Gateway, the admin's), "mine"
// (an old setting: the first biggest view) or "view:<id>" (a biggest view).
// A setting that can't be shown falls back to By lesson.
export function resolveHomeView({ levelView, isAdmin, libraryReady, roots }) {
  const v = String(levelView || "lesson");
  if (v === "course") return isAdmin ? "course" : "lesson";
  if (v === "mine") return roots?.[0] ? `view:${roots[0].id}` : "lesson";
  if (v.startsWith("view:")) return !libraryReady || (roots && !roots.some((r) => `view:${r.id}` === v)) ? "lesson" : v;
  return v;
}

// The tabs in order: Gateway (admin, unless a biggest view of theirs is called Gateway), By lesson, then each biggest view.
export function homeTabs({ isAdmin, libraryReady, roots }) {
  const list = roots || [];
  const ownGateway = list.some((r) => r.name.toLowerCase() === "gateway");
  return [
    ...(isAdmin && !ownGateway ? [["course", "Gateway"]] : []),
    ["lesson", "By lesson"],
    ...(libraryReady ? list.map((r) => [`view:${r.id}`, r.name]) : []),
  ];
}

// A player (not the admin) sees only what is in their own library: the items
// of each lesson that are in it, and no lesson that ends up empty. Items are { kind, obj }.
export function inLibrary(item, keys) {
  return item.kind === "word" ? keys.words.has(item.obj.word) : item.kind === "grammar" ? keys.rules.has(item.obj.id) : false;
}
export function limitLessons(levels, keys) {
  return levels.map((l) => ({ ...l, items: l.items.filter((it) => inLibrary(it, keys)) })).filter((l) => l.items.length);
}

// The words and rules of a list of items, as the scope a practice round is narrowed to.
export function itemsScope(items) {
  return { words: new Set(items.filter((i) => i.kind === "word").map((i) => i.obj.word)), rules: new Set(items.filter((i) => i.kind === "grammar").map((i) => i.obj.id)) };
}

// "3 words · 2 grammar rules" for a list of items.
export function describeItems(items) {
  const w = items.filter((it) => it.kind === "word").length, g = items.length - w;
  return [w && `${w} word${w === 1 ? "" : "s"}`, g && `${g} grammar rule${g === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

// Today's goal as Home shows it: answered of the goal, the accuracy (none before the first answer), whether it is
// reached, and the questions past it. `today` is the day's count ({ answered, correct }).
export function goalView(today, goal) {
  const done = today.answered >= goal;
  return {
    done, answered: today.answered, goal,
    accuracy: today.answered ? Math.round(today.correct / today.answered * 100) : null,
    width: Math.min(100, today.answered / goal * 100),
    bonus: done && today.answered > goal ? today.answered - goal : 0,
  };
}

// The stories in the order Home lists them: fewest new words (target words not yet known) first. Each with its new
// words and the player's best result (if solved). `known(record)` says whether a word is known.
export function storyList(stories, words, mastery, solved, findWord, known) {
  const fresh = (story) => story.targetWords.filter((w) => !known(mastery[findWord(words, w)?.word])).length;
  return [...stories].sort((a, b) => fresh(a) - fresh(b)).map((story) => ({ story, fresh: fresh(story), record: solved.find((e) => e.id === story.id) || null }));
}

// The Speed Round card: locked with fewer than `min` mastered words (how many more to master), else the pool and
// the bests.
export function speedCard(mastered, min, bestScore, bestCombo) {
  if (mastered < min) {
    const more = min - mastered;
    return { locked: true, text: `Master ${more} more word${more === 1 ? "" : "s"} to unlock` };
  }
  return { locked: false, text: `${mastered} mastered words in the pool · best ${bestScore} pts, x${bestCombo} combo` };
}
