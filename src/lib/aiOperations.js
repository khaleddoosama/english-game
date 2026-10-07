import { withRequestTimeout } from "./requestTimeout.js";

let snapshot = [], serial = 0;
const listeners = new Set(), active = new Map();
const bySignal = new WeakMap();
export const subscribeAiOperations = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getAiOperations = () => snapshot;
const publish = () => { for (const listener of listeners) listener(); };
function patch(id, fields) { snapshot = snapshot.map(item => item.id === id ? { ...item, ...fields } : item); publish(); }
export function describeAiError(error) {
  if (error?.name === "AbortError") return "Cancelled. You can try again when ready.";
  if (error?.name === "TimeoutError") return "AI took too long. Please try again.";
  if (error?.status === 401) return "Your session expired. Sign in again.";
  if (error?.status === 403) return "This feature is unavailable for your account.";
  if (error?.status === 429) return "Your AI allowance is reached. Try again later.";
  if (error?.status >= 500) return "AI is unavailable right now. Please try again later.";
  if (error instanceof SyntaxError) return "AI returned an unreadable answer. Please try again.";
  return String(error?.message || "AI couldn't complete this task. Please try again.").slice(0, 240);
}
export const isAiCancelled = error => error?.name === "AbortError";
export function updateAiOperation(signal, fields) { const id = signal && bySignal.get(signal); if (id) patch(id, fields); }
export function cancelAiOperation(id) { active.get(id)?.abort(); }
export function cancelAiTasks(labels, { includeBackground = false } = {}) {
  for (const item of snapshot) if (item.status === "running" && (includeBackground || !item.background) && (!labels || labels.includes(item.label))) cancelAiOperation(item.id);
}
export function dismissAiOperation(id) { snapshot = snapshot.filter(item => item.id !== id || item.status === "running"); publish(); }

export async function runAiOperation(label, operation, options = {}) {
  // Nested generation / validation belongs to the same cancellable job.
  if (options.signal && bySignal.has(options.signal)) {
    options.signal.throwIfAborted();
    const value = await operation(options.signal);
    options.signal.throwIfAborted();
    return value;
  }
  const id = `ai-${++serial}`, controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  snapshot = [...snapshot.filter(item => item.status === "running"), ...snapshot.filter(item => item.status === "failed").slice(-4), { id, label, status: "running", phase: "Preparing", startedAt: Date.now(), background: !!options.background }];
  active.set(id, controller); publish();
  try {
    const value = await withRequestTimeout(async signal => {
      bySignal.set(signal, id);
      signal.throwIfAborted();
      const result = await operation(signal);
      signal.throwIfAborted();
      return result;
    }, options.timeoutMs || 50000, "AI took too long to complete this task.", controller.signal);
    patch(id, { status: "done", phase: "Completed", endedAt: Date.now() });
    return value;
  } catch (error) {
    if (error instanceof Error) error.message = describeAiError(error);
    patch(id, { status: isAiCancelled(error) ? "cancelled" : "failed", error: describeAiError(error), endedAt: Date.now() });
    throw error;
  } finally {
    active.delete(id); options.signal?.removeEventListener("abort", onAbort);
  }
}

// Existing public signatures stay intact; an optional final {signal} lets
// batches and component lifetimes cancel nested work together.
export function managedAiFunction(label, implementation, arity, defaults = {}) {
  return (...args) => {
    const options = args.length > arity ? args.pop() || {} : {};
    while (args.length < arity) args.push(undefined);
    return runAiOperation(label, signal => implementation(...args, { ...options, signal }), { ...defaults, ...options });
  };
}
