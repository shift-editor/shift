import type { Point } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "../../model/Glyph";
import { MovementAxis, PositionReference } from "../../model/positions/index";

/** How an Option-modified move slides one point without bending the curve around it. */
export interface PointSlide {
  readonly axis: MovementAxis;
  /** Whether point rules may move neighbors, such as the opposite handle of a smooth junction. */
  readonly handlesFollow: boolean;
}

/**
 * Resolves the axis an Option-modified move slides a single point along.
 *
 * @remarks
 * An on-curve point slides along the line through its adjacent handles, which stay put; with
 * one handle it slides along that handle's direction. A cubic handle slides along its own
 * direction from its anchor, so only its length changes.
 *
 * @param layer - Authored layer that owns the point.
 * @param pointId - Point being moved on its own.
 * @returns The slide, or null when the point has no handle to define a direction.
 */
export function pointSlide(layer: GlyphLayer, pointId: PointId): PointSlide | null {
  const contourId = layer.contourIdOfPoint(pointId);
  const contour = contourId ? layer.contour(contourId) : null;
  const point = layer.point(pointId);
  if (!contour || !point) return null;

  if (point.isOffCurve) {
    const anchor = contour.cubicHandleAnchor(pointId);
    if (!anchor) return null;

    return {
      axis: MovementAxis.between(
        PositionReference.point(anchor.id),
        PositionReference.point(pointId),
      ),
      handlesFollow: true,
    };
  }

  const neighbors = [...contour.withNeighbors()].find((entry) => entry.point.id === pointId);
  const handles = [neighbors?.prev, neighbors?.next].filter(
    (neighbor): neighbor is Point => neighbor?.isOffCurve === true,
  );
  const [first, second] = handles;
  if (!first) return null;

  const axisStart = second ? second.id : pointId;
  return {
    axis: MovementAxis.between(
      PositionReference.point(axisStart),
      PositionReference.point(first.id),
    ),
    handlesFollow: false,
  };
}
