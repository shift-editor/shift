import type { Point2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import type { Behavior } from "../core/Behavior";
import type { Pen } from "./Pen";
import type { GlyphNode } from "@/types/node";
import type { Coordinates } from "@/types/coordinates";

export type PenEndpoint =
  | {
      readonly kind: "corner";
      readonly pointId: PointId;
      readonly position: Point2D;
    }
  | {
      readonly kind: "smooth";
      readonly pointId: PointId;
      readonly position: Point2D;
      readonly outgoingHandlePosition: Point2D;
    };

export interface PenCurve {
  readonly start: PenEndpoint;
  readonly anchorPosition: Point2D;
  readonly handlePosition: Point2D;
}

export type PenState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "anchored"; anchorPosition: Point2D }
  | { type: "dragging"; curve: PenCurve };

export type PenBehavior = Behavior<PenState, Pen>;

export interface PenOverlayProps {
  readonly state: PenState;
  readonly pointer: Coordinates | null;
  readonly nodePosition: Point2D | null;
  readonly lastOnCurvePoint: Point2D | null;
}

export type PenContext =
  | {
      readonly glyphNode: GlyphNode;
      readonly activeContourId: null;
      readonly activeEndpoint: null;
    }
  | {
      readonly glyphNode: GlyphNode;
      readonly activeContourId: ContourId;
      readonly activeEndpoint: PenEndpoint;
    };
