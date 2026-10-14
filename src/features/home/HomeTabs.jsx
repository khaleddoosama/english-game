// The row of tabs on Home: By lesson, Gateway (admin), one for each of the
// player's biggest views, a + for a new one and a Catalog button.
export default function HomeTabs({ tabs, active, libraryReady, onSelect, onNew, onCatalog }) {
  return (
    <div className="wh-level-view-toggle" role="group" aria-label="Show views">
      {tabs.map(([id, label]) => (
        <button key={id} className={active === id ? "active" : ""} aria-pressed={active === id} onClick={() => onSelect(id)}>{label}</button>
      ))}
      {libraryReady && <button className="lib-plus lib-tab-plus" aria-label="New view" title="New view" onClick={onNew}>+</button>}
      {libraryReady && <button className="lib-catalog-tab" onClick={onCatalog}>Catalog</button>}
    </div>
  );
}
