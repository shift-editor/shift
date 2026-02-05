import { Contours, Vec2 } from "@shift/geo";
import type { Glyph, Point2D, PointId } from "@shift/types";
import type { SnapPreferences } from "@/types/editor";

const SELF_SNAP_EPSILON = 1e-6;

export interface SnapIndicator {
  lines: Array<{
    from: Point2D;
    to: Point2D;
  }>;
  markers?: Point2D[];
}

export interface SnapSessionConfig {
  anchorPointId: PointId;
  dragStart: Point2D;
  excludedPointIds: PointId[];
}

export interface SnapResult {
  snappedPoint: Point2D;
  indicator?: SnapIndicator;
}

export interface SnapSession {
  snap(point: Point2D, shiftKey: boolean): SnapResult;
  end(): void;
}

export interface SnapPointArgs {
  point: Point2D;
  reference: Point2D;
  shiftKey: boolean;
  snapshot?: Glyph | null;
  preferences: SnapPreferences;
  excludedPointIds?: ReadonlySet<PointId>;
  pointToPointRadius?: number;
  increment?: number;
}

export interface SnapPointResult {
  snappedPoint: Point2D;
  indicator?: SnapIndicator;
  source?: "pointToPoint" | "axis" | "angle";
}

export interface SnapRotationDeltaArgs {
  delta: number;
  previousSnappedAngle: number | null;
  increment?: number;
}

export interface SnapRotationDeltaResult {
  snappedDelta: number;
  snappedAngle: number;
}

export class SnapManager {
  #previousSnappedAngle: number | null = null;

  resolveSnapReference(snapshot: Glyph | null, pointId: PointId, fallback: Point2D): Point2D {
    if (!snapshot) return fallback;

    for (const contour of snapshot.contours) {
      const idx = Contours.findPointIndex(contour, pointId);
      if (idx === -1) continue;

      const point = contour.points[idx];
      if (point.pointType === "onCurve") {
        return fallback;
      }

      const { prev, next } = Contours.neighbors(contour, idx);
      if (!prev || !next) continue;

      // In cubic sequences: anchor -> cp1 -> cp2 -> anchor.
      // cp1 snaps relative to previous anchor, cp2 relative to next anchor.
      if (next.pointType === "offCurve" && prev.pointType === "onCurve") {
        return { x: prev.x, y: prev.y };
      }
      if (next.pointType === "onCurve") {
        return { x: next.x, y: next.y };
      }
      if (prev.pointType === "onCurve") {
        return { x: prev.x, y: prev.y };
      }

      return fallback;
    }

    return fallback;
  }

  createSession(
    config: SnapSessionConfig,
    getSnapshot: () => Glyph | null,
    getPreferences: () => SnapPreferences,
    screenToUpmDistance: (px: number) => number,
  ): SnapSession {
    const { anchorPointId, dragStart, excludedPointIds } = config;
    const snapshot = getSnapshot();
    const reference = this.resolveSnapReference(snapshot, anchorPointId, dragStart);
    const excludedSet = new Set(excludedPointIds);

    let previousSnappedAngle: number | null = null;

    const session: SnapSession = {
      snap: (point: Point2D, shiftKey: boolean): SnapResult => {
        const prefs = getPreferences();
        const result = this.snapPointInternal({
          point,
          reference,
          shiftKey,
          snapshot: getSnapshot(),
          preferences: prefs,
          excludedPointIds: excludedSet,
          pointToPointRadius: screenToUpmDistance(prefs.pointRadiusPx),
          increment: (prefs.angleIncrementDeg * Math.PI) / 180,
          previousSnappedAngle,
        });
        previousSnappedAngle = result.newSnappedAngle;
        return {
          snappedPoint: result.snappedPoint,
          indicator: result.indicator,
        };
      },
      end: () => {
        previousSnappedAngle = null;
      },
    };

    return session;
  }

  snapPoint({
    point,
    reference,
    shiftKey,
    snapshot,
    preferences,
    excludedPointIds,
    pointToPointRadius = 8,
    increment = Math.PI / 4,
  }: SnapPointArgs): SnapPointResult {
    const result = this.snapPointInternal({
      point,
      reference,
      shiftKey,
      snapshot,
      preferences,
      excludedPointIds,
      pointToPointRadius,
      increment,
      previousSnappedAngle: this.#previousSnappedAngle,
    });
    this.#previousSnappedAngle = result.newSnappedAngle;
    return {
      snappedPoint: result.snappedPoint,
      indicator: result.indicator,
      source: result.source,
    };
  }

  private snapPointInternal({
    point,
    reference,
    shiftKey,
    snapshot,
    preferences,
    excludedPointIds,
    pointToPointRadius = 8,
    increment = Math.PI / 4,
    previousSnappedAngle,
  }: {
    point: Point2D;
    reference: Point2D;
    shiftKey: boolean;
    snapshot?: Glyph | null;
    preferences: SnapPreferences;
    excludedPointIds?: ReadonlySet<PointId>;
    pointToPointRadius?: number;
    increment?: number;
    previousSnappedAngle: number | null;
  }): SnapPointResult & { newSnappedAngle: number | null } {
    const effectivePreferences = this.resolvePolicy(shiftKey, preferences);
    if (!effectivePreferences.enabled) {
      return { snappedPoint: point, newSnappedAngle: null };
    }

    const candidates: (SnapPointResult & { newSnappedAngle: number | null })[] = [];

    if (effectivePreferences.pointToPoint && snapshot) {
      const pointSnap = this.snapToNearestPoint(
        point,
        snapshot,
        excludedPointIds,
        pointToPointRadius,
      );
      if (pointSnap) {
        return {
          snappedPoint: pointSnap.snappedPoint,
          source: "pointToPoint",
          indicator: {
            lines: [
              {
                from: point,
                to: pointSnap.snappedPoint,
              },
            ],
            markers: [{ x: pointSnap.snappedPoint.x, y: pointSnap.snappedPoint.y }],
          },
          newSnappedAngle: null,
        };
      }
    }

    const delta = Vec2.sub(point, reference);

    if (effectivePreferences.axis && snapshot) {
      const axisSnap = this.snapToAxisLines(point, snapshot, excludedPointIds, pointToPointRadius);
      if (axisSnap) {
        candidates.push({
          snappedPoint: axisSnap.snappedPoint,
          source: "axis",
          indicator: {
            lines: [
              ...(axisSnap.xGuide
                ? [
                    {
                      from: axisSnap.xGuide,
                      to: {
                        x: axisSnap.snappedPoint.x,
                        y: axisSnap.snappedPoint.y,
                      },
                    },
                  ]
                : []),
              ...(axisSnap.yGuide
                ? [
                    {
                      from: axisSnap.yGuide,
                      to: {
                        x: axisSnap.snappedPoint.x,
                        y: axisSnap.snappedPoint.y,
                      },
                    },
                  ]
                : []),
            ],
          },
          newSnappedAngle: null,
        });
      }
    }

    if (effectivePreferences.angle) {
      const result = Vec2.snapToAngleWithHysteresis(delta, previousSnappedAngle, increment);
      const snappedPoint = Vec2.add(reference, result.position);
      candidates.push({
        snappedPoint,
        source: "angle",
        indicator: {
          lines: [
            {
              from: reference,
              to: snappedPoint,
            },
          ],
        },
        newSnappedAngle: Vec2.angle(Vec2.sub(snappedPoint, reference)),
      });
    }

    if (candidates.length > 0) {
      const best = candidates.reduce((best, candidate) =>
        Vec2.dist(candidate.snappedPoint, point) < Vec2.dist(best.snappedPoint, point)
          ? candidate
          : best,
      );
      return best;
    }

    return {
      snappedPoint: point,
      newSnappedAngle: null,
    };
  }

  snapRotationDelta({
    delta,
    previousSnappedAngle,
    increment = Math.PI / 12,
  }: SnapRotationDeltaArgs): SnapRotationDeltaResult {
    const snappedDelta = Vec2.snapAngleWithHysteresis(delta, previousSnappedAngle, increment);
    return {
      snappedDelta,
      snappedAngle: snappedDelta,
    };
  }

  private resolvePolicy(shiftKey: boolean, preferences: SnapPreferences): SnapPreferences {
    if (!preferences.enabled) {
      return { ...preferences, angle: false, axis: false, pointToPoint: false };
    }

    return {
      ...preferences,
      angle: preferences.angle && shiftKey,
      axis: preferences.axis && !shiftKey,
      pointToPoint: preferences.pointToPoint && !shiftKey,
    };
  }

  private snapToNearestPoint(
    point: Point2D,
    snapshot: Glyph,
    excludedPointIds: ReadonlySet<PointId> | undefined,
    radius: number,
  ): { snappedPoint: Point2D } | null {
    let best: { point: Point2D; distance: number } | null = null;

    for (const contour of snapshot.contours) {
      for (const candidate of contour.points) {
        if (excludedPointIds?.has(candidate.id)) continue;
        if (Vec2.dist(point, candidate) <= SELF_SNAP_EPSILON) continue;
        const distance = Vec2.dist(point, candidate);
        if (distance > radius) continue;
        if (!best || distance < best.distance) {
          best = {
            point: { x: candidate.x, y: candidate.y },
            distance,
          };
        }
      }
    }

    if (!best) return null;
    return { snappedPoint: best.point };
  }

  private snapToAxisLines(
    point: Point2D,
    snapshot: Glyph,
    excludedPointIds: ReadonlySet<PointId> | undefined,
    radius: number,
  ): {
    snappedPoint: Point2D;
    snappedX: boolean;
    snappedY: boolean;
    xGuide?: Point2D;
    yGuide?: Point2D;
  } | null {
    let bestX: { point: Point2D; dist: number } | null = null;
    let bestY: { point: Point2D; dist: number } | null = null;

    for (const contour of snapshot.contours) {
      for (const candidate of contour.points) {
        if (excludedPointIds?.has(candidate.id)) continue;
        if (Vec2.dist(point, candidate) <= SELF_SNAP_EPSILON) continue;

        const xDist = Math.abs(point.x - candidate.x);
        if (xDist <= radius && (!bestX || xDist < bestX.dist)) {
          bestX = { point: { x: candidate.x, y: candidate.y }, dist: xDist };
        }

        const yDist = Math.abs(point.y - candidate.y);
        if (yDist <= radius && (!bestY || yDist < bestY.dist)) {
          bestY = { point: { x: candidate.x, y: candidate.y }, dist: yDist };
        }
      }
    }

    if (!bestX && !bestY) return null;

    const snappedX = bestX !== null;
    const snappedY = bestY !== null;
    const snappedPoint = {
      x: snappedX ? bestX.point.x : point.x,
      y: snappedY ? bestY.point.y : point.y,
    };

    return {
      snappedPoint,
      snappedX,
      snappedY,
      xGuide: snappedX ? bestX.point : undefined,
      yGuide: snappedY ? bestY.point : undefined,
    };
  }
}
