// A word's correct-answer streak (reviewStep) cannot climb past this step
// until it has been produced correctly at least once (typing / gapTyping);
// once held here it only gets typing questions until it produces.
// Lives on its own so the V2 engine has no imports (no module cycle).
export const PRODUCTION_GATE_STEP = 2;
