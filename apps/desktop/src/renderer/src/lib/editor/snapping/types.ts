/**
 * Snapping type definitions.
 *
 * The snapping system uses a **session-based API** backed by a **step pipeline**.
 * Callers create a {@link DragSnapSession} or {@link RotateSnapSession}, then call
 * `snap()` on each pointer/rotation event. Internally, the session feeds the input
 * through an ordered list of {@link PointSnapStep} or {@link RotateSnapStep} objects.
 *
 * Resolution is **priority-based**: point-to-point snaps always win over metric or
 * angle snaps; among the remaining candidates the closest result is chosen. Rotate
 * pipelines use first-match semantics.
 *
 * All coordinates in these types are in **UPM space** unless noted otherwise.
 * Screen-space conversion (e.g. snap radius) is handled by
 * {@link Snap.screenToUpmDistance}.
 */
import type { FontMetrics, Glyph, Point2D, PointId } from "@shift/types";
import type { SnapPreferences } from "@/types/editor";

/** Visual feedback for an active snap: guide lines and optional target markers, both in UPM space. */
export interface SnapIndicator {
  lines: Array<{
    from: Point2D;
    to: Point2D;
  }>;
  markers?: Point2D[];
}

/**
 * Mutable state carried across consecutive snap calls within a session.
 * Stores the last snapped angle so hysteresis can prevent jitter near angle boundaries.
 */
export interface SnapContext {
  previousSnappedAngle: number | null;
}

/** Categories of snappable objects that can be requested when building the source list. */
export type SnappableInclude = "points" | "metrics";

/** Describes which snap sources to gather and which points to exclude (typically the dragged points). */
export interface SnappableQuery {
  include: readonly SnappableInclude[];
  excludedPointIds?: readonly PointId[];
}

/**
 * A target that can attract a dragged point.
 * - `"pointTarget"` — an anchor or control point in the glyph (UPM coords).
 * - `"metricGuide"` — a horizontal font metric line (baseline, x-height, etc.).
 */
export type SnappableObject =
  | { kind: "pointTarget"; id: PointId; point: Point2D }
  | { kind: "metricGuide"; y: number; label: string };

/**
 * Input bundle passed to each {@link PointSnapStep} in the pipeline.
 * Contains the candidate point, its drag reference origin, modifier keys,
 * accumulated context, all snap sources, user preferences, and thresholds.
 */
export interface PointSnapStepArgs {
  point: Point2D;
  reference: Point2D;
  modifiers: { shiftKey: boolean };
  context: SnapContext;
  sources: readonly SnappableObject[];
  preferences: SnapPreferences;
  radius: number;
  increment: number;
}

/** Output of a single point snap step: the corrected position, which source matched, and optional visual indicator. */
export interface PointStepResult {
  snappedPoint: Point2D;
  source: "pointToPoint" | "metrics" | "angle";
  indicator: SnapIndicator | null;
}

/**
 * A single stage in the point snap pipeline. Each step inspects the input and
 * either returns a {@link PointStepResult} (snap hit) or `null` (no match).
 */
export interface PointSnapStep {
  id: string;
  apply(args: PointSnapStepArgs): PointStepResult | null;
}

/** Input bundle passed to each {@link RotateSnapStep}. Contains the raw rotation delta (radians) and modifier state. */
export interface RotateSnapStepArgs {
  delta: number;
  modifiers: { shiftKey: boolean };
  context: SnapContext;
  preferences: SnapPreferences;
  increment: number;
}

/** Output of a single rotate snap step: the quantized delta and its source. */
export interface RotateStepResult {
  snappedDelta: number;
  source: "angle";
  indicator: SnapIndicator | null;
}

/**
 * A single stage in the rotate snap pipeline. Returns a {@link RotateStepResult}
 * when the rotation delta should be quantized, or `null` to pass through.
 */
export interface RotateSnapStep {
  id: string;
  apply(args: RotateSnapStepArgs): RotateStepResult | null;
}

/** Final resolved result of a point snap pipeline run. If no step matched, `source` is `null` and `point` is unchanged. */
export interface PointSnapResult {
  point: Point2D;
  indicator: SnapIndicator | null;
  source: "pointToPoint" | "metrics" | "angle" | null;
}

/** Final resolved result of a rotate snap pipeline run. If no step matched, `source` is `null` and `delta` is unchanged. */
export interface RotateSnapResult {
  delta: number;
  source: "angle" | null;
}

/**
 * Configuration for creating a {@link DragSnapSession}.
 * Identifies the anchor being dragged and which points to exclude from snap targets.
 */
export interface DragSnapSessionConfig {
  anchorPointId: PointId;
  dragStart: Point2D;
  excludedPointIds?: readonly PointId[];
}

/**
 * Stateful session for snapping a dragged point. Created once at drag start;
 * call `snap()` on each pointer move and `clear()` when the drag ends.
 * The session owns the {@link SnapContext} that provides angle hysteresis.
 */
export interface DragSnapSession {
  getAnchorPosition(): Point2D;
  snap(point: Point2D, modifiers: { shiftKey: boolean }): PointSnapResult;
  clear(): void;
}

/**
 * Stateful session for snapping a rotation delta. Created once at rotate start;
 * call `snap()` on each rotation event and `clear()` when rotation ends.
 */
export interface RotateSnapSession {
  snap(delta: number, modifiers: { shiftKey: boolean }): RotateSnapResult;
  clear(): void;
}

/**
 * Dependency interface for {@link SnapManager}. Provides access to the
 * current glyph, font metrics, user preferences, and a screen-to-UPM distance
 * converter for resolving pixel-based snap radii into UPM units.
 */
export interface Snap {
  getGlyph(): Glyph | null;
  getMetrics(): FontMetrics;
  getSnapPreferences(): SnapPreferences;
  screenToUpmDistance(px: number): number;
}
