// Bound the whole operation, including authentication and reading a response.
// The race also settles when an upstream mock/provider ignores AbortSignal.
export async function withRequestTimeout(operation, timeoutMs, message) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(message), { name: "TimeoutError" }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
