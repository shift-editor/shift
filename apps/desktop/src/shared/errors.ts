/**
 * Converts an unknown thrown value into a message suitable for IPC payloads.
 *
 * @param error - Value caught at an async or cross-process boundary.
 * @returns a stable string message; never throws while formatting.
 */
export function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

/** A thrown error as it crosses a process boundary, safe to structured-clone. */
export interface TransportError {
  readonly name: string;
  readonly message: string;
  /** A Node error code such as `ENOENT`, or `null` when the error has none. */
  readonly code: string | null;
  /** The stack where the error was thrown, in the remote process. */
  readonly stack: string | null;
}

/**
 * Captures what callers need from a thrown value before it crosses a process boundary.
 *
 * @param error - Value caught by a request handler.
 * @returns the error's name, message, code and stack; never throws while reading them.
 */
export function toTransportError(error: unknown): TransportError {
  const message = errorToMessage(error);
  if (!(error instanceof Error)) return { name: "Error", message, code: null, stack: null };

  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  return { name: error.name, message, code, stack: error.stack ?? null };
}

/**
 * Rebuilds a thrown error on the calling side of a process boundary.
 *
 * @param error - The error a remote handler reported.
 * @returns an `Error` with the remote name, code and stack, so callers can
 * branch on `name` or `code` as if the handler had thrown locally.
 */
export function fromTransportError(error: TransportError): Error {
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;
  if (error.stack) rebuilt.stack = error.stack;
  if (error.code) return Object.assign(rebuilt, { code: error.code });
  return rebuilt;
}
