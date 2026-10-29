/**
 * Questions tests ask of an outline read. Each is a pure function of
 * the data a read returns, so it answers the same for either driver's result.
 *
 * @example
 * expect(pointTypes((await editor.outline())[0]!.points)).toEqual(["onCurve", "offCurve", "onCurve"]);
 *
 * To compare what two outlines draw, ids aside, use the `toDrawLike` matcher.
 *
 * This file imports types only, so `apps/desktop/e2e` can import it.
 */
import type { PointType } from "@shift/types";
import type { OutlinePoint } from "./reads";

/** Each point's type, in order. */
export function pointTypes(points: readonly Pick<OutlinePoint, "pointType">[]): PointType[] {
  return points.map(({ pointType }) => pointType);
}
