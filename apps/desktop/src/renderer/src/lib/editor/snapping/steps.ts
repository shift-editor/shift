/**
 * Snap step factories and source collectors.
 *
 * Each factory returns a stateless {@link PointSnapStep} or {@link RotateSnapStep}
 * that can be fed into {@link SnapPipelineRunner}. Steps are evaluated in pipeline
 * order; the runner handles priority resolution (point-to-point wins, then closest
 * for point pipelines; first-match for rotate pipelines).
 *
 * Steps are **pure** — all mutable state lives in the {@link SnapContext} passed
 * through `args`. This keeps steps composable and testable in isolation.
 */
import { Vec2 } from "@shift/geo";
import type { FontMetrics, Point2D } from "@shift/types";
import type { PointSnapStep, RotateSnapStep, SnappableObject } from "./types";

/**
 * Minimum distance (in UPM) below which a source point is treated as the
 * dragged point itself and ignored. Prevents a point from snapping to its
 * own position.
 */
const SELF_SNAP_EPSILON = 1e-6;

/**
 * Snaps the dragged point to the nearest anchor or control point within the
 * snap radius. Skips self-matches via {@link SELF_SNAP_EPSILON}. Disabled when
 * Shift is held (angle snap takes precedence). This is the highest-priority
 * point step — the pipeline runner short-circuits when it matches.
 */
export function createPointToPointStep(): PointSnapStep {
  return {
    id: "pointToPoint",
    apply: ({ point, modifiers, sources, preferences, radius }) => {
      if (!preferences.enabled || !preferences.pointToPoint || modifiers.shiftKey) return null;

      let best: { point: Point2D; distance: number } | null = null;
      for (const source of sources) {
        if (source.kind !== "pointTarget") continue;
        if (Vec2.dist(point, source.point) <= SELF_SNAP_EPSILON) continue;
        const distance = Vec2.dist(point, source.point);
        if (distance > radius) continue;
        if (!best || distance < best.distance) {
          best = { point: source.point, distance };
        }
      }

      if (!best) return null;
      return {
        snappedPoint: best.point,
        source: "pointToPoint",
        indicator: {
          lines: [{ from: point, to: best.point }],
          markers: [{ x: best.point.x, y: best.point.y }],
        },
      };
    },
  };
}

/**
 * Snaps the dragged point's Y coordinate to the nearest horizontal font metric
 * guide (baseline, x-height, cap-height, ascender, descender) within the snap
 * radius. X is left unchanged. Disabled when Shift is held.
 */
export function createMetricsStep(): PointSnapStep {
  return {
    id: "metrics",
    apply: ({ point, modifiers, sources, preferences, radius }) => {
      if (!preferences.enabled || !preferences.metrics || modifiers.shiftKey) return null;

      let bestY: number | null = null;
      let bestDist = Infinity;

      for (const source of sources) {
        if (source.kind !== "metricGuide") continue;
        const dist = Math.abs(point.y - source.y);
        if (dist <= radius && dist < bestDist) {
          bestY = source.y;
          bestDist = dist;
        }
      }

      if (bestY === null) return null;

      const snappedPoint = { x: point.x, y: bestY };
      return {
        snappedPoint,
        source: "metrics",
        indicator: {
          lines: [{ from: { x: 0, y: bestY }, to: snappedPoint }],
        },
      };
    },
  };
}

/**
 * Constrains the drag vector from the reference point to the nearest angle
 * increment (e.g. 15-degree steps). Only active when Shift is held. Uses
 * hysteresis via {@link SnapContext.previousSnappedAngle} to prevent jitter
 * near angle boundaries.
 */
export function createAngleStep(): PointSnapStep {
  return {
    id: "angle",
    apply: ({ point, reference, modifiers, context, preferences, increment }) => {
      if (!preferences.enabled || !preferences.angle || !modifiers.shiftKey) {
        context.previousSnappedAngle = null;
        return null;
      }

      const delta = Vec2.sub(point, reference);
      const snapped = Vec2.snapToAngleWithHysteresis(
        delta,
        context.previousSnappedAngle,
        increment,
      );
      const snappedPoint = Vec2.add(reference, snapped.position);
      context.previousSnappedAngle = Vec2.angle(Vec2.sub(snappedPoint, reference));

      return {
        snappedPoint,
        source: "angle",
        indicator: {
          lines: [{ from: reference, to: snappedPoint }],
        },
      };
    },
  };
}

/**
 * Quantizes a rotation delta to 15-degree increments when Shift is held.
 * Uses hysteresis to avoid oscillation near snap boundaries. This is the
 * rotate-pipeline counterpart of {@link createAngleStep}.
 */
export function createRotateAngleStep(): RotateSnapStep {
  return {
    id: "rotateAngle",
    apply: ({ delta, modifiers, context, preferences }) => {
      if (!preferences.enabled || !preferences.angle || !modifiers.shiftKey) {
        context.previousSnappedAngle = null;
        return null;
      }

      const snappedDelta = Vec2.snapAngleWithHysteresis(
        delta,
        context.previousSnappedAngle,
        Math.PI / 12,
      );
      context.previousSnappedAngle = snappedDelta;

      return {
        snappedDelta,
        source: "angle",
        indicator: null,
      };
    },
  };
}

/**
 * Converts {@link FontMetrics} into an array of `"metricGuide"` snap sources.
 * Returns guides for baseline (y=0), x-height, cap-height, ascender, and descender.
 * Returns an empty array when metrics are unavailable.
 */
export function collectMetricSources(metrics: FontMetrics): SnappableObject[] {
  return [
    { kind: "metricGuide", y: 0, label: "baseline" },
    { kind: "metricGuide", y: metrics.xHeight ?? 0, label: "xHeight" },
    { kind: "metricGuide", y: metrics.capHeight ?? 0, label: "capHeight" },
    { kind: "metricGuide", y: metrics.ascender, label: "ascender" },
    { kind: "metricGuide", y: metrics.descender, label: "descender" },
  ];
}
