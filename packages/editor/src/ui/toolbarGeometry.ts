import type { Point2D } from "@shift/geo";
import type { ToolbarDock, ToolbarFrame } from "../types/toolbar";

/** Bar thickness across its tools, in either orientation. */
export const BAR_THICKNESS = 48;

/** Gap between a slot and the canvas edge, matching `inset-3` on the overlay. */
export const TOOLBAR_INSET = 12;

/** The size of a measured box, as the frame the bar docks against. */
export function frameOf(rect: DOMRect): ToolbarFrame {
  return { width: rect.width, height: rect.height };
}

/** Gap between each canvas edge and a point. */
export function pointerEdgeDistances(
  pointer: Point2D,
  frame: ToolbarFrame,
): Record<ToolbarDock, number> {
  return {
    top: pointer.y,
    bottom: frame.height - pointer.y,
    left: pointer.x,
    right: frame.width - pointer.x,
  };
}

function clampAxis(value: number, limit: number): number {
  const min = TOOLBAR_INSET;
  const max = limit - TOOLBAR_INSET;
  if (max < min) return value;

  return Math.min(Math.max(value, min), max);
}

/**
 * Keeps the handle inside the frame so it can always be seen and grabbed.
 *
 * @remarks
 * Only the handle is held in. The rest of the bar may run past the frame
 * edge while it is carried, so a turned bar never stops short of an edge
 * because of its length.
 */
export function clampHandleToFrame(handle: Point2D, frame: ToolbarFrame): Point2D {
  return { x: clampAxis(handle.x, frame.width), y: clampAxis(handle.y, frame.height) };
}
