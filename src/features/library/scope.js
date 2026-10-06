// Practice content is derived from the user's explicit selection. Empty means
// empty; it must never fall back to the entire catalogue.
export function sessionFitsLibrary(session, words) {
  if (!session) return true;
  const selected = new Set(words.map(w=>w.word.toLowerCase()));
  const targets = [...[...(session.words || []),...(session.introductions || [])].map(w=>typeof w==='string'?w:w?.word), ...(session.queue || []).flatMap(q=>q.targets || [])].filter(Boolean);
  return targets.length > 0 && targets.every(w=>selected.has(String(w).toLowerCase()));
}
export function selectedStories(stories, words) {
  const selected = new Set(words.map(w=>w.word.toLowerCase()));
  return stories.filter(s=>s.targetWords?.length && s.targetWords.every(w=>selected.has(String(w).toLowerCase())));
}

export function preparePersonalContent(content) {
  const words = Array.isArray(content?.words) ? content.words : [];
  const grammar = Array.isArray(content?.grammar) ? content.grammar : [];
  const used = new Set([...words, ...grammar].map(item => item.category).filter(Boolean));
  const order = (content?.levelOrder || []).filter(category => used.has(category));
  for (const category of used) if (!order.includes(category)) order.push(category);
  return { ...content, words, grammar, levelOrder: order };
}

export function personalPracticeContent(library, extras = {}) {
  const words = library.words || [];
  const selected = new Set(words.map(w => w.word.toLowerCase()));
  return { ...library,
    combos: (extras.combos || []).filter(c => c.words?.length && c.words.every(w => selected.has(String(w).toLowerCase()))),
    stories: selectedStories(extras.stories || [], words),
  };
}
