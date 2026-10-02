export const VIEW_RESUME_DEBOUNCE_MS = 500;

export type ViewResumeCaptureDecision =
  | { kind: "skip"; reason: "within-debounce" }
  | { kind: "capture"; reason: "state-changed" | "flushed" };

/**
 * Decides whether a view-resume snapshot should be persisted for the current timestamp.
 */
export function viewResumeCaptureDecision(
  lastCapturedAtMs: number | null,
  nowMs: number,
  flush: boolean,
): ViewResumeCaptureDecision {
  if (flush) return { kind: "capture", reason: "flushed" };
  if (lastCapturedAtMs === null) return { kind: "capture", reason: "state-changed" };

  if (nowMs - lastCapturedAtMs < VIEW_RESUME_DEBOUNCE_MS) {
    return { kind: "skip", reason: "within-debounce" };
  }

  return { kind: "capture", reason: "state-changed" };
}
