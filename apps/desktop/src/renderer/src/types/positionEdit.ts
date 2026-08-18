import type { Point2D } from "@shift/geo";
import type { AnchorId, MetricKind, PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";

/** Point and anchor identities transformed together by one position edit. */
export interface PositionTargets {
  readonly points?: readonly PointId[];
  readonly anchors?: readonly AnchorId[];
}

/** Normalized editable position targets that share one authored layer. */
export interface PositionSelection {
  readonly layer: GlyphLayer;
  readonly targets: PositionTargets;
}

/** Shared terminal operations exposed by every fluent position edit. */
export interface PositionEdit {
  commit(): void;
  discard(): void;
}

/** Internal lifecycle of one configured position edit. */
export type PositionEditPhase = "configuring" | "previewing" | "committed" | "discarded";

/** Optional activation predicate evaluated for each preview frame. */
export interface PositionCondition {
  readonly when: () => boolean;
}

/** Direction segment emitted while a movement vector is quantized. */
export interface DirectionPositionGuide {
  readonly kind: "direction";
  readonly from: Point2D;
  readonly to: Point2D;
}

/** Horizontal metric emitted while a reference position is snapped. */
export interface MetricPositionGuide {
  readonly kind: "metric";
  readonly metric: MetricKind;
  readonly y: number;
}

/** Semantic visual guide emitted by a position edit preview. */
export type PositionGuide = DirectionPositionGuide | MetricPositionGuide;

/** Candidate correction returned by a position snap provider. */
export interface PositionSnap {
  readonly point: Point2D;
  readonly distance: number;
  readonly guides: readonly PositionGuide[];
}

/** Source-neutral position snapping contract consumed by MoveEdit. */
export interface PositionSnapProvider {
  snap(point: Point2D): PositionSnap | null;
}

/** Effective movement and visual feedback produced for one preview frame. */
export interface PositionFeedback {
  readonly delta: Point2D;
  readonly guides: readonly PositionGuide[];
}
