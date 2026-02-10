import type { Point2D, PointId } from "@shift/types";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";
import type { PenAction } from "./actions";

/** The on-curve anchor point placed by a pen click, plus its contour context. */
export interface AnchorData {
  position: Point2D;
  pointId: PointId;
  context: ContourContext;
}

/** References to the incoming and outgoing off-curve control points of an anchor. */
export interface HandleData {
  cpIn?: PointId;
  cpOut?: PointId;
}

/** Information about the contour being drawn, used to decide how the next point connects. */
export interface ContourContext {
  previousPointType: "none" | "onCurve" | "offCurve";
  previousOnCurvePosition: Point2D | null;
  isFirstPoint: boolean;
}

/**
 * State machine for the pen tool.
 *
 * - `idle` -- tool is inactive (no glyph loaded or tool not selected).
 * - `ready` -- cursor is in the viewport, waiting for a click to place an anchor.
 * - `anchored` -- an anchor has been placed; next gesture decides if it stays a corner or becomes a curve.
 * - `dragging` -- user is dragging out bezier handles from the anchor.
 */
export type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
      snappedPos?: Point2D;
    };

/** Behavior type alias for the pen tool's state/event/action triple. */
export type PenBehavior = Behavior<PenState, ToolEvent, PenAction>;
