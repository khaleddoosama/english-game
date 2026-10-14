// The "are you sure" boxes: resetting progress, wiping everything, and deleting a lesson (category).
const Overlay = ({ onClose, children }) => (
  <div className="wh-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="wh-panel wh-confirm-panel" role="alertdialog">{children}</div>
  </div>
);

// action: "reset" or "wipe". onConfirm runs the action (it may be async); the box closes after.
export function ResetConfirm({ action, onConfirm, onClose }) {
  const reset = action === "reset";
  return (
    <Overlay onClose={onClose}>
      <p>
        {reset
          ? "Reset all progress? This clears your score, streaks, mastery, and level stats. Your imported words and content stay untouched."
          : "Clear everything? This deletes your progress AND all imported words, grammar, and stories. This cannot be undone — make sure you have a Full Backup first."}
      </p>
      <div className="wh-regen-actions">
        <button className="wh-level-btn" onClick={async () => { await onConfirm(); onClose(); }}>{reset ? "Yes, reset progress" : "Yes, delete everything"}</button>
        <button className="wh-back-btn wh-nav-btn" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}

export function DeleteCategoryConfirm({ level, onConfirm, onClose }) {
  return (
    <Overlay onClose={onClose}>
      <p>Delete the category "{level.title}"? This removes its words, grammar, combos, stories, and challenges from your content. This cannot be undone — make sure you have a Full Backup first.</p>
      <div className="wh-regen-actions">
        <button className="wh-level-btn wh-danger-btn" onClick={() => { onConfirm(level); onClose(); }}>Yes, delete category</button>
        <button className="wh-back-btn wh-nav-btn" onClick={onClose}>Cancel</button>
      </div>
    </Overlay>
  );
}
