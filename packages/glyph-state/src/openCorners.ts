import type { NewPoint } from "./Point";
import type { ContourGeometry } from "./types/contour";
import { geometry as rules } from "@shift/wasm";
import type { Outline } from "@shift/wasm/protocol";

/**
 * The contour's outline with its outside open corners erased, as export
 * erases them (shift-font's `open_corners::erase_open_corners`, which calls
 * fontc's rule).
 *
 * @remarks
 * An open corner has no point: the two edges overshoot it and meet through
 * a short line, and the small triangle beyond the crossing is erased. The
 * contour's points stay as authored; this is the outline to fill.
 *
 * @param contour - Ordered points and closure, in contour coordinates.
 * @returns The erased outline, or `null` when the contour has no open corner.
 */
export function erasedOutline<TPoint extends NewPoint>(
  contour: ContourGeometry<TPoint>,
): Outline | null {
  const { points, closed } = contour;
  if (points.length === 0) return null;

  const coordinates: number[] = [];
  for (const point of points) coordinates.push(point.x, point.y);
  return rules.erasedOutline({
    closed,
    pointTypes: points.map((point) => point.pointType),
    coordinates,
  });
}
