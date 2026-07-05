import type { Point2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import type { Behavior } from "../core/Behavior";
import type { Pen } from "./Pen";
import type { GlyphNode } from "@/types/node";

export interface Anchor {
  position: Point2D;
  pointId?: PointId;
}

export interface Handles {
  cpIn?: PointId;
  cpOut?: PointId;
}

export type PenState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "anchored"; anchor: Anchor }
  | {
      type: "dragging";
      anchor: Anchor;
      handles: Handles;
      mousePos: Point2D;
    };

export type PenBehavior = Behavior<PenState, Pen>;

export interface PenContext {
  glyphNode: GlyphNode;
  activeContourId: ContourId | null;
}
