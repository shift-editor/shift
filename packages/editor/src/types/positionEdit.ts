import type { Point2D } from "@shift/geo";
import type { AnchorId, MetricKind, PointId } from "@shift/types";
import type { GlyphLayer } from "../lib/model/Glyph";

/** Point and anchor identities transformed together by one position edit. */
export interface PositionTargets {
  readonly points?: readonly PointId[];
  readonly anchors?: readonly AnchorId[];
}

/** Normalized editable position targets for one authored layer. */
export interface PositionSelectionLayer {
  readonly layer: GlyphLayer;
  readonly targets: PositionTargets;
}

/** Reference-layer position targets and their matched additional layers. */
export interface PositionSelection extends PositionSelectionLayer {
  readonly additionalLayers: readonly PositionSelectionLayer[];
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

/** Direction segment optionally emitted while a movement vector is quantized. */
export interface DirectionPositionGuide {
  readonly kind: "direction";
  readonly from: Point2D;
  readonly to: Point2D;
}

/** Horizontal metric that one snapped position, at glyph-local `(x, y)`, now sits on. */
export interface MetricPositionGuide {
  readonly kind: "metric";
  readonly metric: MetricKind;
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned line from a stationary point to a moving position that now shares its x or y. */
export interface AlignmentPositionGuide {
  readonly kind: "alignment";
  readonly target: Point2D;
  readonly point: Point2D;
}

/** Semantic visual guide emitted by a position edit preview. */
export type PositionGuide = DirectionPositionGuide | MetricPositionGuide | AlignmentPositionGuide;

/** Correction along one axis; its distance is the absolute offset. */
export interface AxisSnap {
  /** Signed font-unit offset added to the candidate coordinate on this axis. */
  readonly offset: number;
  readonly guides: readonly PositionGuide[];
}

/**
 * Candidate correction returned by a position snap provider.
 *
 * @remarks
 * Axes snap independently so a y-only target, such as a metric, never blocks
 * an x correction from another provider. A null axis leaves that coordinate free.
 */
export interface PositionSnap {
  readonly x: AxisSnap | null;
  readonly y: AxisSnap | null;
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
