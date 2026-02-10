import type { BoundingRectEdge } from "@/lib/tools/select/cursor";

/**
 * One of the four corners of a bounding box. Combined with the four
 * {@link BoundingRectEdge} positions, these form the 8 interactive handles
 * around a selection. Corners are used as rotation handles; edges as resize handles.
 */
export type CornerHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Result of hit-testing against a bounding box.
 *
 * Returns `"resize"` with the contacted edge when the cursor is on an edge handle,
 * `"rotate"` with the contacted corner when hovering outside a corner, or `null`
 * when the cursor does not intersect any handle.
 */
export type BoundingBoxHitResult =
  | { type: "resize"; edge: Exclude<BoundingRectEdge, null> }
  | { type: "rotate"; corner: CornerHandle }
  | null;
