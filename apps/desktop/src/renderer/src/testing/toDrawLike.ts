/**
 * The `toDrawLike` matcher: an outline that draws what the expected outline
 * draws, whichever contour and point ids draw it.
 *
 * @example
 * const fitted = await editor.outline();
 * await editor.undo();
 * await editor.redo();
 * expect(await editor.outline()).toDrawLike(fitted);
 *
 * @remarks
 * Both outlines must have the same contours in order, each with the same
 * closed flag and the same points in order, each with the same `x`, `y`,
 * `pointType` and `smooth`. Contour and point ids are ignored, so an edit
 * that replaces points still compares equal; a contour that starts at another
 * point or runs the other way does not. The failure message names the first
 * contour or point that differs.
 *
 * One implementation for both drivers: vitest registers it in `setup.ts`, and
 * Playwright's `expect` in `e2e/fixtures/matchers.ts`. It is a pure function
 * of the received and expected values and imports types only, so the E2E
 * build can load it.
 */
import type { Outline, OutlineContour, OutlinePoint } from "./reads";
import type { MatcherResult } from "./toBeNear";

/** Whether `received` is an outline that draws the same contours and points as `expected`. */
export function toDrawLike(received: unknown, expected: Outline): MatcherResult {
  const difference = isOutline(received)
    ? outlineDifference(received, expected)
    : `received ${String(received)}, which is not an outline`;
  const pass = difference === null;
  return {
    pass,
    message: () =>
      pass
        ? "expected the outline not to draw like the expected outline"
        : `expected the outline to draw like the expected outline, but ${difference}`,
  };
}

/** The first way `received` draws differently from `expected`, or null when they draw alike. */
function outlineDifference(received: Outline, expected: Outline): string | null {
  if (received.length !== expected.length) {
    return `it has ${received.length} contours, not ${expected.length}`;
  }
  for (const [index, contour] of received.entries()) {
    const difference = contourDifference(contour, expected[index]!);
    if (difference !== null) return `contour ${index} ${difference}`;
  }
  return null;
}

function contourDifference(received: OutlineContour, expected: OutlineContour): string | null {
  if (received.closed !== expected.closed) {
    return `is ${closedness(received)}, not ${closedness(expected)}`;
  }
  if (received.points.length !== expected.points.length) {
    return `has ${received.points.length} points, not ${expected.points.length}`;
  }
  for (const [index, point] of received.points.entries()) {
    const other = expected.points[index]!;
    const drawsAlike =
      point.x === other.x &&
      point.y === other.y &&
      point.pointType === other.pointType &&
      point.smooth === other.smooth;
    if (!drawsAlike) return `point ${index} is ${format(point)}, not ${format(other)}`;
  }
  return null;
}

function closedness(contour: OutlineContour): string {
  return contour.closed ? "closed" : "open";
}

function format({ x, y, pointType, smooth }: OutlinePoint): string {
  return `{ x: ${x}, y: ${y}, pointType: ${pointType}, smooth: ${smooth} }`;
}

function isOutline(value: unknown): value is Outline {
  return Array.isArray(value) && value.every(isContour);
}

function isContour(value: unknown): value is OutlineContour {
  if (!isObject(value)) return false;
  const { closed, points } = value as Partial<Record<"closed" | "points", unknown>>;
  return typeof closed === "boolean" && Array.isArray(points) && points.every(isObject);
}

function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}
