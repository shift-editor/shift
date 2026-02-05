import { Vec2 } from "@shift/geo";
import type { FontMetrics, Point2D } from "@shift/types";
import type { PointSnapStep, RotateSnapStep, SnappableObject } from "./types";

const SELF_SNAP_EPSILON = 1e-6;

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

export function collectMetricSources(metrics: FontMetrics | null): SnappableObject[] {
  if (!metrics) return [];
  return [
    { kind: "metricGuide", y: 0, label: "baseline" },
    { kind: "metricGuide", y: metrics.xHeight ?? 0, label: "xHeight" },
    { kind: "metricGuide", y: metrics.capHeight ?? 0, label: "capHeight" },
    { kind: "metricGuide", y: metrics.ascender, label: "ascender" },
    { kind: "metricGuide", y: metrics.descender, label: "descender" },
  ];
}
