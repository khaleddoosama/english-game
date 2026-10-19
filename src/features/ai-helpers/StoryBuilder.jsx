// The Stories page's "Generate a mixed-category story" (admin) and the preview of a new story. story: what
// useStoryGeneration returns. Docs: docs/modules/ai-media/story-generation.md.

export function StoryBuilder({ story, isAdmin, gameContent }) {
  const { categories, error, state, generate, toggleCategory, add, discard } = story;
  return <>
    {isAdmin && <div className="wh-story-builder"><h3>Generate a mixed-category story</h3><p className="wh-regen-meta">Choose one or more categories. Weak words are selected first and distributed across your choices.</p><div className="wh-category-multiselect">{gameContent().levelOrder.filter((category) => gameContent().words.some((word) => word.category === category)).map((category) => <label key={category} className={`wh-category-choice ${categories.includes(category) ? "selected" : ""}`}><input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} /><span>{category}</span><small>{gameContent().words.filter((word) => word.category === category).length}</small></label>)}</div>{state !== "loading" && <button className="wh-level-btn" disabled={!categories.length} onClick={generate}>✨ Generate from {categories.length || 0} categor{categories.length === 1 ? "y" : "ies"}</button>}{error && state !== "loading" && <p className="wh-regen-status error">{error}</p>}</div>}
    {state === "loading" && <p className="wh-regen-status">Writing and checking a new story…</p>}
    {state && typeof state === "object" && <div className="wh-regen-preview">
      <p className="wh-regen-label">New story — preview</p>
      <p><strong>{state.title}</strong></p>
      <p>{state.text}</p>
      <p className="wh-regen-meta">Categories: {(state.sourceCategories || []).join(" + ")} · Hidden targets: {state.targetWords.join(", ")} · {state.questions.length} questions{state.grammarQuestions?.length ? ` + ${state.grammarQuestions.length} grammar` : ""}</p>
      <div className="wh-regen-actions">
        <button className="wh-level-btn" onClick={add}>Add to My Stories</button>
        <button className="wh-back-btn wh-nav-btn" onClick={generate}>Regenerate</button>
        <button className="wh-back-btn wh-nav-btn" onClick={discard}>Discard</button>
      </div>
    </div>}
  </>;
}
