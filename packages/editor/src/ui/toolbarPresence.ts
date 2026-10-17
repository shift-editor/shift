import type { ToolDipKeyframe } from "../types/toolbar";

/** Duration of the tools' opacity transition while the pointer moves. */
export const TOOL_FADE_MS = 120;

/** Opacity the tools settle at once the pointer is in range of a slot that turns the bar. */
export const TOOL_FLOOR_OPACITY = 0.4;

/**
 * Opacity the tools reach at the midpoint of a turn. Low enough to quiet the
 * icons while they swing, but not hidden: the tools keep their order across a
 * turn, so nothing needs to be concealed.
 */
export const TOOL_TURN_OPACITY = 0.25;

/**
 * Where in a turn, as a share of the way round, the tools are dimmed: they reach
 * `TOOL_TURN_OPACITY` by `from`, stay there until `to`, and are fully back by `restoredBy`.
 * The dim sits early in the swing so the icons are legible again well before the
 * bar settles on its final angle.
 */
export const TOOL_TURN_DIM = { from: 0.2, to: 0.5, restoredBy: 0.9 } as const;

/**
 * Keyframes that dim the tools over the early part of a turn.
 *
 * @param fromOpacity - Opacity the tools had when the turn began.
 * @param timeAtProgress - Fraction of the turn's duration at which the turn has
 *   covered a given share of its distance (see `springEasing`).
 */
export function toolDipKeyframes(
  fromOpacity: number,
  timeAtProgress: (progress: number) => number,
): ToolDipKeyframe[] {
  return [
    { opacity: fromOpacity, offset: 0 },
    { opacity: TOOL_TURN_OPACITY, offset: timeAtProgress(TOOL_TURN_DIM.from) },
    { opacity: TOOL_TURN_OPACITY, offset: timeAtProgress(TOOL_TURN_DIM.to) },
    { opacity: 1, offset: timeAtProgress(TOOL_TURN_DIM.restoredBy) },
    { opacity: 1, offset: 1 },
  ];
}

/** Longest distance over which the tools fade as the pointer nears a slot that turns the bar. */
export const TOOL_FADE_SPAN = 240;

/**
 * Opacity of the tools for a pointer `distanceBeyondRange` pixels outside the
 * range of the nearest slot that would turn the bar, or null if none would.
 *
 * @remarks
 * The tools fade linearly over `span` pixels, from fully visible to
 * `TOOL_FLOOR_OPACITY`, and never to nothing.
 */
export function toolOpacityForApproach(distanceBeyondRange: number | null, span: number): number {
  if (distanceBeyondRange === null || span <= 0) return 1;

  const progress = Math.min(Math.max(distanceBeyondRange / span, 0), 1);

  return TOOL_FLOOR_OPACITY + (1 - TOOL_FLOOR_OPACITY) * progress;
}
