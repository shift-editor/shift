import type { Data } from "@paulirish/trace_engine/models/trace/handlers/AnimationFramesHandler.js";
import {
  isAnimationFrameAsyncStart,
  isPerformanceMark,
  type Event as TraceEvent,
} from "@paulirish/trace_engine/models/trace/types/TraceEvents.js";

/**
 * Finds the first presented frame containing the verified submitted geometry.
 *
 * @remarks
 * DevTools owns frame pairing. This adapter requires one trusted-input mark,
 * checks submission evidence, and resolves coalesced frames by their last draw.
 * Submissions after a verified presentation cannot invalidate that endpoint.
 * Baseline verification belongs to the caller, before input and trace capture.
 *
 * @param events - Chromium trace events containing input and submission marks.
 * @param data - AnimationFramesHandler output for the same trace.
 * @returns Input-to-geometry presentation latency in milliseconds.
 * @throws {Error} When relevant input, submission, frame, or feedback evidence is
 *   missing, ambiguous, or invalid, or no presented frame matches the geometry.
 */
export function findGeometryPresentation(events: readonly TraceEvent[], data: Data): number {
  const inputs = events.filter((event) => event.name === "inputToGeometryFrameMs");
  if (inputs.length !== 1) throw new Error("Expected exactly one recorded input");

  const input = inputs[0]!;
  if (!isPerformanceMark(input) || !Number.isFinite(input.ts)) {
    throw new Error("Input timestamp is missing or invalid");
  }

  const timeline = events
    .filter((event) => event.pid === input.pid && event.tid === input.tid)
    .sort((a, b) => a.ts - b.ts);
  if (
    timeline.some(
      (event) => event.name === "shift:geometry-submitted" && !Number.isFinite(event.ts),
    )
  ) {
    throw new Error("Geometry timestamp is missing or invalid");
  }
  const draws = timeline.filter(
    (event) => event.name === "shift:geometry-submitted" && event.ts >= input.ts,
  );
  if (!draws.length) throw new Error("No geometry draw was observed after input");

  const animationFrames = data.animationFrames.filter(
    (frame) => frame.pid === input.pid && frame.tid === input.tid,
  );
  const frames = new Map<string, number>();
  for (const draw of draws) {
    if (draw.ts > Math.min(...frames.values())) break;

    const containing = animationFrames.filter(
      (frame) => frame.ts <= draw.ts && frame.ts + frame.dur >= draw.ts,
    );
    const frame = containing[0];
    if (!isPerformanceMark(draw) || !Number.isFinite(draw.ts)) {
      throw new Error("Geometry verification is missing or invalid");
    }
    const matches = draw.args.data?.detail;
    if (matches !== "true" && matches !== "false") {
      throw new Error("Geometry verification is not a recorded boolean");
    }
    if (!frame || containing.length !== 1) {
      throw new Error("Verified geometry is not inside a recorded browser frame");
    }
    // DevTools pairs by index; a missing end must not borrow the next frame's end.
    if (
      timeline.some(
        (event) =>
          isAnimationFrameAsyncStart(event) &&
          event.ts > frame.ts &&
          event.ts < frame.ts + frame.dur,
      )
    ) {
      throw new Error("Verified geometry is not inside a recorded browser frame");
    }

    const presentation = data.presentationForFrame.get(frame);
    if (!presentation) throw new Error("Verified frame has no presentation feedback");
    if (
      !Number.isFinite(presentation.ts) ||
      presentation.ts < frame.ts + frame.dur ||
      presentation.pid !== input.pid ||
      presentation.tid !== input.tid
    ) {
      throw new Error("Presentation feedback is invalid");
    }

    const args = presentation.args;
    if (!args || !("begin_frame_id" in args)) {
      throw new Error("Presented frame identity is missing");
    }
    const id = args.begin_frame_id;
    if (!id || typeof id !== "object" || !("source_id" in id) || !("sequence_number" in id)) {
      throw new Error("Presented frame identity is incomplete");
    }
    if (id.source_id === 0 && id.sequence_number === 0) continue;
    if (
      typeof id.source_id !== "number" ||
      !Number.isSafeInteger(id.source_id) ||
      id.source_id <= 0 ||
      typeof id.sequence_number !== "number" ||
      !Number.isSafeInteger(id.sequence_number) ||
      id.sequence_number <= 0
    ) {
      throw new Error("Presented frame identity is invalid");
    }

    // Replacing a coalesced frame with Infinity removes an overwritten match.
    frames.set(
      `${id.source_id}:${id.sequence_number}`,
      matches === "true" ? presentation.ts : Infinity,
    );
  }

  const presentedAt = Math.min(...frames.values());
  if (!Number.isFinite(presentedAt)) {
    throw new Error("No presented frame contains the expected geometry");
  }

  return (presentedAt - input.ts) / 1_000;
}
