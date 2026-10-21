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

/** Centre of an element's box, in viewport coordinates. */
export function centreOf(element: HTMLElement): Point2D {
  const rect = element.getBoundingClientRect();

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Share of the frame's height, from each of top and bottom, that docks the bar to that edge. */
export const FLAT_ZONE_SHARE = 0.25;

/** Share of the frame's width, from each of left and right, that docks the bar to that side. */
export const SIDE_ZONE_SHARE = 1 / 3;

/** Region of the frame whose pointer docks the bar to one edge; outer sides run on past the frame. */
export interface DockZone {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The region of the frame that docks the bar to `dock`.
 *
 * @remarks
 * The top and bottom quarters dock to their edge. In the band between them
 * the outer thirds dock to their side, and the centre third belongs to no
 * zone. When the frame only holds a flat bar, its top and bottom halves split
 * the whole frame.
 */
export function dockZone(dock: ToolbarDock, frame: ToolbarFrame, flatOnly: boolean): DockZone {
  const share = flatOnly ? 0.5 : FLAT_ZONE_SHARE;
  const bandTop = frame.height * share;
  const bandBottom = frame.height * (1 - share);
  const leftEnd = frame.width * SIDE_ZONE_SHARE;
  const rightStart = frame.width * (1 - SIDE_ZONE_SHARE);

  switch (dock) {
    case "top":
      return { left: -Infinity, top: -Infinity, right: Infinity, bottom: bandTop };
    case "bottom":
      return { left: -Infinity, top: bandBottom, right: Infinity, bottom: Infinity };
    case "left":
      return { left: -Infinity, top: bandTop, right: leftEnd, bottom: bandBottom };
    case "right":
      return { left: rightStart, top: bandTop, right: Infinity, bottom: bandBottom };
  }
}

/**
 * Whether `pointer` lies in the zone that docks to `dock`, with the zone
 * grown by `margin` on every side.
 */
export function isInDockZone(
  dock: ToolbarDock,
  pointer: Point2D,
  frame: ToolbarFrame,
  flatOnly: boolean,
  margin = 0,
): boolean {
  const zone = dockZone(dock, frame, flatOnly);

  return (
    pointer.x >= zone.left - margin &&
    pointer.x <= zone.right + margin &&
    pointer.y >= zone.top - margin &&
    pointer.y <= zone.bottom + margin
  );
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
