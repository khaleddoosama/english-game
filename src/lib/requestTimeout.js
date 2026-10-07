// Bound the whole operation, including authentication and reading a response.
// The race also settles when an upstream mock/provider ignores AbortSignal.
export async function withRequestTimeout(operation, timeoutMs, message, signal) {
  const controller = new AbortController();
  let timer;
  let onAbort;
  const deadline = new Promise((_, reject) => {
    onAbort = () => {
      reject(Object.assign(new Error("AI request cancelled. You can try again."), { name: "AbortError", code: "AI_CANCELLED" }));
      controller.abort();
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      reject(Object.assign(new Error(message), { name: "TimeoutError" }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
