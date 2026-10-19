// Loading and saving the content, the steps with no state: what is saved, the warning after a failed save, and the
// words after their embedded pictures were stored. Moved unchanged out of the app shell (src/app/WordHunter.jsx); see
// docs/modules/content/content-sync.md.
import { isEmbeddedImage } from "../../lib/images";

// What one content save sends.
export const contentPayload = ({ note, combos, stories, words, grammar, challenges }, levelOrder) => ({ note, combos, stories, words, grammar, challenges, levelOrder });

// What the storage warning says after a failed content save.
export const contentSaveWarning = (e) => (e?.conflict ? e.message : "Content could not be saved to the server. Check your connection; your last change will be saved with the next edit. Take a Full Backup if this keeps happening.");

// The pictures stored inside the words (data: images).
export const embeddedPictures = (words) => words.map((w) => w.image).filter(isEmbeddedImage);
// The words with each stored picture replaced by its link; a word whose picture changed meanwhile is left as it is.
export const withStoredPictures = (words, stored) => words.map((w) => (stored.has(w.image) ? { ...w, image: stored.get(w.image) } : w));
