/**
 * Asymmetric matchers for points in an {@link Outline}, for outlines whose
 * positions come out of a gesture and so are only close to round numbers.
 *
 * @example
 * expect((await editor.outline())[0]?.points).toMatchObject([
 *   onCurve(100, 100),
 *   offCurve(166.67, 100),
 *   offCurve(220, 20),
 *   onCurve(300, 100),
 * ]);
 * expect(await editor.pointPositions([corner])).toEqual({ [corner]: near({ x: 186.6, y: 150 }) });
 */
import { expect } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointType } from "@shift/types";

/** Matches a point of `pointType` within 0.01 units of `x`, `y`. */
function pointNear(pointType: PointType, x: number, y: number) {
  return { pointType, x: expect.closeTo(x, 2), y: expect.closeTo(y, 2) };
}

/** Matches an on-curve point within 0.01 units of `x`, `y`. */
export function onCurve(x: number, y: number) {
  return pointNear("onCurve", x, y);
}

/** Matches an off-curve control within 0.01 units of `x`, `y`. */
export function offCurve(x: number, y: number) {
  return pointNear("offCurve", x, y);
}

/**
 * Matches a position whose `x` and `y` each round to `position`'s at `digits`
 * decimal places, as `toBeCloseTo` compares a number.
 */
export function near(position: Point2D, digits = 2) {
  return { x: expect.closeTo(position.x, digits), y: expect.closeTo(position.y, digits) };
}
