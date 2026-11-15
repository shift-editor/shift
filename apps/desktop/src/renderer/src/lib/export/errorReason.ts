/** The message an export failure carries, for showing under a generic headline. */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
