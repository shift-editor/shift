import type { ToolDipKeyframe } from "../types/toolbar";

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
 * @param timeAtProgress - Fraction of the turn's duration at which the turn has
 *   covered a given share of its distance (see `springEasing`).
 */
export function toolDipKeyframes(timeAtProgress: (progress: number) => number): ToolDipKeyframe[] {
  return [
    { opacity: 1, offset: 0 },
    { opacity: TOOL_TURN_OPACITY, offset: timeAtProgress(TOOL_TURN_DIM.from) },
    { opacity: TOOL_TURN_OPACITY, offset: timeAtProgress(TOOL_TURN_DIM.to) },
    { opacity: 1, offset: timeAtProgress(TOOL_TURN_DIM.restoredBy) },
    { opacity: 1, offset: 1 },
  ];
}
