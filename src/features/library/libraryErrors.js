// The error every library API throws, whichever side answers: the server's
// message and SQLSTATE code, or the local mirror's copy of them.
export class LibraryError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Turns whatever the transport threw into a LibraryError (a dropped
// connection gets a plain "offline" message).
export function friendlyError(error) {
  if (error instanceof LibraryError) return error;
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new LibraryError("You're offline. The library needs a connection.", "offline");
  return new LibraryError(msg, error?.code);
}
