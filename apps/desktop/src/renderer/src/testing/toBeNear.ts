/**
 * The `toBeNear` matcher: a position whose `x` and `y` each round to the
 * expected position's at `digits` decimal places, as `toBeCloseTo` compares a
 * number.
 *
 * @example
 * expect(await editor.point(corner)).toBeNear({ x: 186.6, y: 150 });
 * expect(editor.drawnSnapGuides()).toMatchObject([{ to: expect.toBeNear({ x: 186.6, y: 150 }) }]);
 *
 * @remarks
 * One implementation for both drivers: vitest registers it in `setup.ts`, and
 * Playwright's `expect` in `e2e/fixtures/matchers.ts`. It is a pure function
 * of the received and expected values and imports types only, so the E2E
 * build can load it.
 */
import type { Point2D } from "@shift/geo";

/** What a matcher returns to vitest's and Playwright's `expect`. */
export interface MatcherResult {
  readonly pass: boolean;
  readonly message: () => string;
}

/**
 * Whether `received` is a position within half of `10 ** -digits` of
 * `expected` on each axis.
 *
 * @param digits - decimal places both coordinates must agree to; 2 by default.
 */
export function toBeNear(received: unknown, expected: Point2D, digits = 2): MatcherResult {
  const tolerance = 10 ** -digits / 2;
  const pass =
    isPosition(received) &&
    isClose(received.x, expected.x, tolerance) &&
    isClose(received.y, expected.y, tolerance);
  const shown = isPosition(received) ? format(received) : String(received);
  return {
    pass,
    message: () =>
      `expected ${shown} ${pass ? "not " : ""}to be near ${format(expected)} (${digits} decimal places)`,
  };
}

function isPosition(value: unknown): value is Point2D {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Partial<Record<"x" | "y", unknown>>;
  return typeof x === "number" && typeof y === "number";
}

function isClose(received: number, expected: number, tolerance: number): boolean {
  if (received === expected) return true;
  return Math.abs(received - expected) < tolerance;
}

function format({ x, y }: Point2D): string {
  return `{ x: ${x}, y: ${y} }`;
}
