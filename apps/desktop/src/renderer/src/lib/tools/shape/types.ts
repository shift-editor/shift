import type { Point2D, Rect2D } from "@shift/geo";
import type { NewPoint } from "@shift/glyph-state";
import type { Behavior } from "../core/Behavior";

/** Defines geometry for one closed contour, independently of tool interaction and persistence. */
export interface Shape {
  readonly label: string;

  /**
   * Creates the anchors and controls used for both preview and commit.
   *
   * @param bounds - Drag origin and signed dimensions in glyph units.
   * @returns Fresh ordered points; closure is implicit and the first anchor is not repeated.
   */
  createPoints(bounds: Rect2D): readonly NewPoint[];
}

export type ShapeKind = "rectangle" | "ellipse";

export type ShapeState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; startPos: Point2D; currentPos: Point2D };

export type ShapeBehavior = Behavior<ShapeState>;
