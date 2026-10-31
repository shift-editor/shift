import type { Point2D, Rect2D } from "@shift/geo";
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

/** Share of the shorter frame side the centre square may fill, so every edge keeps a region to itself. */
const CENTRE_SQUARE_MAX_SHARE = 0.8;

/**
 * Share of each corner rectangle, along both its sides, that the edge across the seat's axis catches.
 *
 * @remarks
 * Half puts the catch rectangle's far corner exactly on the corner's diagonal.
 */
const CORNER_CATCH_SHARE = 0.5;

function centreSquareSide(frame: ToolbarFrame, barLength: number): number {
  return Math.min(barLength, CENTRE_SQUARE_MAX_SHARE * Math.min(frame.width, frame.height));
}

/**
 * The square at the middle of the frame that belongs to no dock.
 *
 * @remarks
 * It is as wide as the bar is long, so it is the area the bar sweeps when it
 * turns about a handle at the frame's centre. A shorter frame side caps it at
 * four fifths of that side.
 */
export function centreSquare(frame: ToolbarFrame, barLength: number): Rect2D {
  const side = centreSquareSide(frame, barLength);
  const left = (frame.width - side) / 2;
  const top = (frame.height - side) / 2;

  return {
    x: left,
    y: top,
    width: side,
    height: side,
    left,
    top,
    right: left + side,
    bottom: top + side,
  };
}

/** Whether the bar carried from `seatDock` stands on the left or right edge, so its axis of travel is horizontal. */
function travelsAcross(seatDock: ToolbarDock): boolean {
  return seatDock === "left" || seatDock === "right";
}

/**
 * The dock `point` belongs to.
 *
 * @remarks
 * The frame around the centre square is cut into the four trapezoids that
 * face its sides. Each corner rectangle splits on its diagonal, from the frame
 * corner to the square's corner, so a point goes to the edge it is
 * proportionally nearer; a point exactly on a diagonal goes to the top or
 * bottom edge. Points beyond the frame belong to the edge they lie past.
 *
 * The corner itself is caught early: the part of each corner rectangle within
 * `CORNER_CATCH_SHARE` of the frame corner on both sides belongs to the edge
 * across the seat's axis, the one a bar turning away from its seat is heading
 * for, so a handle hugging an edge does not wait for the diagonal.
 *
 * The centre square splits across the axis the bar was carried along: a bar
 * from a left or right seat gets a left and a right half, a bar from a top or
 * bottom seat a top and a bottom half. A point on the midline goes to the
 * right or bottom half. A frame that only holds a flat bar splits into a top
 * and a bottom half.
 */
export function dockRegionAt(
  point: Point2D,
  frame: ToolbarFrame,
  barLength: number,
  flatOnly: boolean,
  seatDock: ToolbarDock,
): ToolbarDock {
  if (flatOnly) return point.y < frame.height / 2 ? "top" : "bottom";

  const square = centreSquare(frame, barLength);
  const pastLeft = point.x < square.left;
  const pastRight = point.x > square.right;
  const pastTop = point.y < square.top;
  const pastBottom = point.y > square.bottom;
  const alongX = !pastLeft && !pastRight;
  const alongY = !pastTop && !pastBottom;
  if (alongX && alongY) return centreHalfAt(point, square, seatDock);
  if (alongX) return pastTop ? "top" : "bottom";
  if (alongY) return pastLeft ? "left" : "right";

  // In a corner rectangle, compare how far the point has come from each edge as a share of that rectangle's side.
  const fromSide = (pastLeft ? point.x : frame.width - point.x) / square.left;
  const fromEnd = (pastTop ? point.y : frame.height - point.y) / square.top;
  if (fromSide < CORNER_CATCH_SHARE && fromEnd < CORNER_CATCH_SHARE) {
    if (travelsAcross(seatDock)) return pastTop ? "top" : "bottom";

    return pastLeft ? "left" : "right";
  }
  if (fromEnd <= fromSide) return pastTop ? "top" : "bottom";

  return pastLeft ? "left" : "right";
}

function centreHalfAt(point: Point2D, square: Rect2D, seatDock: ToolbarDock): ToolbarDock {
  if (travelsAcross(seatDock)) return point.x < (square.left + square.right) / 2 ? "left" : "right";

  return point.y < (square.top + square.bottom) / 2 ? "top" : "bottom";
}

/**
 * Corners of the half of the centre square that `dockRegionAt` gives to `dock`
 * for a bar carried from `seatDock`, or none when `dock` is across the other axis.
 */
export function centreHalfPolygon(
  dock: ToolbarDock,
  frame: ToolbarFrame,
  barLength: number,
  seatDock: ToolbarDock,
): Point2D[] {
  const { left, top, right, bottom } = centreSquare(frame, barLength);
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const dockAcross = dock === "left" || dock === "right";
  if (dockAcross !== travelsAcross(seatDock)) return [];

  switch (dock) {
    case "left":
      return rectangle(left, top, midX, bottom);
    case "right":
      return rectangle(midX, top, right, bottom);
    case "top":
      return rectangle(left, top, right, midY);
    case "bottom":
      return rectangle(left, midY, right, bottom);
  }
}

function rectangle(left: number, top: number, right: number, bottom: number): Point2D[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * Corners of the part of the region `dockRegionAt` gives to `dock` outside the
 * centre square for a bar carried from `seatDock`, in drawing order, clipped to the frame.
 */
export function dockRegionPolygon(
  dock: ToolbarDock,
  frame: ToolbarFrame,
  barLength: number,
  flatOnly: boolean,
  seatDock: ToolbarDock,
): Point2D[] {
  const { width, height } = frame;
  if (flatOnly) {
    const half = height / 2;
    if (dock === "top") return rectangle(0, 0, width, half);

    return rectangle(0, half, width, height);
  }

  const { left, top, right, bottom } = centreSquare(frame, barLength);
  const catchWidth = CORNER_CATCH_SHARE * left;
  const catchHeight = CORNER_CATCH_SHARE * top;
  const nearRight = width - catchWidth;
  const nearBottom = height - catchHeight;
  const catches = (dock === "left" || dock === "right") !== travelsAcross(seatDock);
  switch (dock) {
    case "top":
      return catches
        ? [
            { x: 0, y: 0 },
            { x: 0, y: catchHeight },
            { x: catchWidth, y: catchHeight },
            { x: left, y: top },
            { x: right, y: top },
            { x: nearRight, y: catchHeight },
            { x: width, y: catchHeight },
            { x: width, y: 0 },
          ]
        : [
            { x: catchWidth, y: 0 },
            { x: nearRight, y: 0 },
            { x: nearRight, y: catchHeight },
            { x: right, y: top },
            { x: left, y: top },
            { x: catchWidth, y: catchHeight },
          ];
    case "bottom":
      return catches
        ? [
            { x: 0, y: height },
            { x: 0, y: nearBottom },
            { x: catchWidth, y: nearBottom },
            { x: left, y: bottom },
            { x: right, y: bottom },
            { x: nearRight, y: nearBottom },
            { x: width, y: nearBottom },
            { x: width, y: height },
          ]
        : [
            { x: catchWidth, y: height },
            { x: nearRight, y: height },
            { x: nearRight, y: nearBottom },
            { x: right, y: bottom },
            { x: left, y: bottom },
            { x: catchWidth, y: nearBottom },
          ];
    case "left":
      return catches
        ? [
            { x: 0, y: 0 },
            { x: catchWidth, y: 0 },
            { x: catchWidth, y: catchHeight },
            { x: left, y: top },
            { x: left, y: bottom },
            { x: catchWidth, y: nearBottom },
            { x: catchWidth, y: height },
            { x: 0, y: height },
          ]
        : [
            { x: 0, y: catchHeight },
            { x: catchWidth, y: catchHeight },
            { x: left, y: top },
            { x: left, y: bottom },
            { x: catchWidth, y: nearBottom },
            { x: 0, y: nearBottom },
          ];
    case "right":
      return catches
        ? [
            { x: width, y: 0 },
            { x: nearRight, y: 0 },
            { x: nearRight, y: catchHeight },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: nearRight, y: nearBottom },
            { x: nearRight, y: height },
            { x: width, y: height },
          ]
        : [
            { x: width, y: catchHeight },
            { x: nearRight, y: catchHeight },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: nearRight, y: nearBottom },
            { x: width, y: nearBottom },
          ];
  }
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
