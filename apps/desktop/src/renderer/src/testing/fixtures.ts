/**
 * Glyph fixtures: plain data describing what a test draws.
 *
 * @example
 * const { start, top } = await editor.draw({
 *   advance: 500,
 *   contours: [{ closed: true, points: [{ x: 0, y: 0, name: "start" }, { x: 50, y: 100, off: true }, { x: 100, y: 0, name: "top" }] }],
 *   anchors: [{ name: "top", x: 50, y: 700 }],
 * });
 *
 * A fixture changes nothing until {@link EditorTestSurface.draw} builds it
 * through the editor's own commands. Point names are literal types, so `draw`
 * returns exactly the names a fixture used.
 */
import type { ContourContent } from "@shift/editor/clipboard";

/** An on-curve corner as `[x, y]`, or a point with its kind and an optional name. */
export type PointFixture<N extends string = string> =
  | readonly [x: number, y: number]
  | {
      readonly x: number;
      readonly y: number;
      readonly off?: true;
      readonly smooth?: true;
      readonly name?: N;
    };

/** A contour, open unless `closed`. */
export interface ContourFixture<N extends string = string> {
  readonly closed?: boolean;
  readonly points: readonly PointFixture<N>[];
}

/** An anchor by name, in glyph units. */
export interface AnchorFixture {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** A component of another glyph in the font, offset by `x`, `y`. */
export interface ComponentFixture {
  readonly glyph: string;
  readonly x?: number;
  readonly y?: number;
}

/** What a test draws into the open glyph. */
export interface GlyphFixture<N extends string = string> {
  readonly advance?: number;
  readonly contours?: readonly ContourFixture<N>[];
  readonly anchors?: readonly AnchorFixture[];
  readonly components?: readonly ComponentFixture[];
}

/** The point names a fixture uses. */
export type PointNames<F extends GlyphFixture> = NonNullable<
  F["contours"]
>[number]["points"][number] extends infer P
  ? P extends { readonly name: infer N extends string }
    ? N
    : never
  : never;

/** A closed square of on-curve corners, `size` units wide, from the origin. */
export function square(size: number): ContourFixture<never> {
  return {
    closed: true,
    points: [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ],
  };
}

/** The clipboard content `draw` inserts for a fixture's contours. */
export function contourContent(contours: readonly ContourFixture[]): {
  contours: ContourContent[];
} {
  return {
    contours: contours.map((contour) => ({
      closed: contour.closed ?? false,
      points: contour.points.map((point) =>
        isCorner(point)
          ? { x: point[0], y: point[1], pointType: "onCurve" as const, smooth: false }
          : {
              x: point.x,
              y: point.y,
              pointType: point.off ? ("offCurve" as const) : ("onCurve" as const),
              smooth: point.smooth ?? false,
            },
      ),
    })),
  };
}

/** Each named point's position in insertion order, which is the order `insertContent` returns ids in. */
export function pointNames(contours: readonly ContourFixture[]): readonly (string | null)[] {
  return contours.flatMap((contour) =>
    contour.points.map((point) => (isCorner(point) ? null : (point.name ?? null))),
  );
}

function isCorner(point: PointFixture): point is readonly [number, number] {
  return Array.isArray(point);
}
