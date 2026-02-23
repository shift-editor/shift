import { Vec2 } from "@shift/geo";
import type { Point2D } from "@shift/geo";

const EPSILON = 1e-10;

/**
 * Repositions the opposite Bezier handle to keep a smooth point tangent.
 *
 * The dragged handle direction is updated from the drag delta (`mousePos`), while
 * the opposite handle keeps its original arm length from `smooth`.
 *
 * @param selectedHandle Current position of the handle being dragged (before applying `mousePos`).
 * @param smooth On-curve smooth point both handles are attached to.
 * @param oppositeHandle Current position of the opposite handle to be recomputed.
 * @param mousePos Drag delta in glyph space.
 * @returns New position for `oppositeHandle`, mirrored along the updated tangent direction.
 */
export function maintainTangency(
  selectedHandle: Point2D,
  smooth: Point2D,
  oppositeHandle: Point2D,
  mousePos: Point2D,
): Point2D {
  const newArmPos = Vec2.add(Vec2.sub(selectedHandle, smooth), mousePos);
  const oppositeArmLen = Vec2.len(Vec2.sub(oppositeHandle, smooth));

  const newArmDir = Vec2.normalize(newArmPos);
  const newOppositePos = Vec2.add(smooth, Vec2.scale(newArmDir, -oppositeArmLen));

  return newOppositePos;
}

/**
 * Projects a dragged handle onto the line defined by a smooth point and its end point.
 *
 * This preserves collinearity for handle/end/smooth relationships while allowing
 * the handle to move farther/closer along that line.
 *
 * @param smoothPos Smooth anchor point that defines the projection origin.
 * @param endPos End point used with `smoothPos` to define the collinearity axis.
 * @param handlePos Current handle position (before applying `mousePos`).
 * @param mousePos Drag delta in glyph space.
 * @returns Projected handle position on the collinearity axis, or `null` when the
 * axis is degenerate (`smoothPos ~= endPos`) or the projection collapses to `smoothPos`.
 */
export function maintainCollinearity(
  smoothPos: Point2D,
  endPos: Point2D,
  handlePos: Point2D,
  mousePos: Point2D,
): Point2D | null {
  const collinearVec = Vec2.sub(smoothPos, endPos);
  const collinearLenSq = Vec2.lenSq(collinearVec);
  if (collinearLenSq < EPSILON * EPSILON) {
    return null;
  }
  const targetPos = Vec2.add(handlePos, mousePos);
  const offsetFromSmooth = Vec2.sub(targetPos, smoothPos);
  const t = Vec2.dot(offsetFromSmooth, collinearVec) / collinearLenSq;
  if (Math.abs(t) < EPSILON) {
    return null;
  }

  const newPos = Vec2.add(smoothPos, Vec2.scale(collinearVec, Math.abs(t)));
  return newPos;
}
