import type { Point2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import type { Behavior } from "../core/Behavior";
import type { Pen } from "./Pen";
import type { GlyphNode } from "../../../types/node";
import type { Coordinates } from "../../../types/coordinates";
import type { PositionGuide } from "../../../types/positionEdit";

export type PenEndpoint =
  | {
      readonly kind: "corner";
      readonly pointId: PointId;
      readonly position: Point2D;
    }
  | {
      /** Tangent-continuous: the next curve starts smooth along the outgoing handle. */
      readonly kind: "smooth";
      readonly pointId: PointId;
      readonly position: Point2D;
      readonly outgoingHandlePosition: Point2D;
    }
  | {
      /** A corner with a handle pulled out of it for the next curve. */
      readonly kind: "cusp";
      readonly pointId: PointId;
      readonly position: Point2D;
      readonly outgoingHandlePosition: Point2D;
    };

export interface PenCurve {
  readonly start: PenEndpoint;
  readonly anchorPosition: Point2D;
  readonly handlePosition: Point2D;
}

/** Press on the active contour's first point; dragging shapes the closing curve. */
export interface PenClose {
  readonly start: PenEndpoint;
  readonly firstPointId: PointId;
  readonly firstPosition: Point2D;
  /** Pointer position after the drag threshold; null while the gesture is still a click. */
  readonly handlePosition: Point2D | null;
}

/** Press on an open end; dragging pulls the next segment's first handle out of it. */
export interface PenPull {
  readonly pointId: PointId;
  readonly position: Point2D;
  /** Pointer position after the drag threshold; null while the gesture is still a press. */
  readonly handlePosition: Point2D | null;
}

export interface PenOutgoingHandle {
  readonly pointId: PointId;
  readonly position: Point2D;
  readonly smooth: boolean;
}

export type PenState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "anchored"; anchorPosition: Point2D }
  | {
      type: "closing";
      close: PenClose;
      shiftKey: boolean;
      /** Glyph-local snap feedback from the latest closing-handle preview. */
      guides: readonly PositionGuide[];
    }
  | {
      type: "pulling";
      pull: PenPull;
      /** Glyph-local snap feedback from the latest pulled-handle preview. */
      guides: readonly PositionGuide[];
    }
  | {
      type: "dragging";
      curve: PenCurve;
      shiftKey: boolean;
      /** Glyph-local incoming-handle feedback from the latest preview. */
      guides: readonly PositionGuide[];
    };

export type PenBehavior = Behavior<PenState, Pen>;

export interface PenOverlayProps {
  readonly state: PenState;
  readonly pointer: Coordinates | null;
  readonly nodePosition: Point2D | null;
  readonly lastOnCurvePoint: Point2D | null;
  /** The active endpoint's handle waiting for the next segment; cleared when the stroke ends. */
  readonly pendingHandle: Point2D | null;
}

export type PenContext =
  | {
      readonly glyphNode: GlyphNode;
      readonly activeContourId: null;
      readonly outgoingHandle: null;
    }
  | {
      readonly glyphNode: GlyphNode;
      readonly activeContourId: ContourId;
      readonly outgoingHandle: PenOutgoingHandle | null;
    };
