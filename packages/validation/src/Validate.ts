import type { PointLike } from "./types";

/**
 * Point-type predicates for editor code that holds points as plain records.
 *
 * @remarks
 * Whether a run of points forms drawable segments is shift-font's rule
 * (`SegmentIndexIter`); there is no TypeScript copy of it.
 */
export const Validate = {
  isOnCurve(point: PointLike): boolean {
    return point.pointType === "onCurve" || point.pointType === "qCurve";
  },

  isOffCurve(point: PointLike): boolean {
    return point.pointType === "offCurve";
  },

  /** Whether `points` holds at least one on-curve point. */
  hasValidAnchor(points: readonly PointLike[]): boolean {
    return points.some(Validate.isOnCurve);
  },
} as const;
