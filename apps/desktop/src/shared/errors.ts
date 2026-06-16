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
