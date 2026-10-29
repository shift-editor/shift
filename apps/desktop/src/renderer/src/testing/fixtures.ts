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
import { Curve, type CubicCurve, type Point2D } from "@shift/geo";
import type { PointType } from "@shift/types";

/** An on-curve corner as `[x, y]`, or a point with its kind and an optional name. */
export type PointFixture<N extends string = string> =
  | readonly [x: number, y: number]
  | {
      readonly x: number;
      readonly y: number;
      readonly off?: true;
      readonly smooth?: true;
      readonly name?: N;
      /** An on-curve point that ends a quadratic run (TrueType's `qCurve`). */
      readonly qCurve?: true;
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

/** How {@link EditorTestSurface.draw} leaves the selection. */
export interface DrawOptions {
  /** Selects every point drawn, as if the test had then selected them all. */
  readonly select?: boolean;
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
              pointType: pointType(point),
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

function pointType(point: Exclude<PointFixture, readonly [number, number]>): PointType {
  if (point.off) return "offCurve";
  if (point.qCurve) return "qCurve";
  return "onCurve";
}

function isCorner(point: PointFixture): point is readonly [number, number] {
  return Array.isArray(point);
}

/** A point a shape factory is given: an on-curve corner as `[x, y]`, or a position with an optional name. */
export type ShapePoint<N extends string = never> =
  | readonly [x: number, y: number]
  | { readonly x: number; readonly y: number; readonly name?: N };

/** A point a shape factory made, carrying the name it was given. */
interface NamedPointFixture<N extends string> {
  readonly x: number;
  readonly y: number;
  readonly off?: true;
  readonly name: N;
}

/**
 * A contour a shape factory made. Its point type lists the names the factory
 * was given, so `draw` returns exactly those names.
 */
export interface ShapeFixture<N extends string = never> extends ContourFixture<N> {
  readonly points: readonly (PointFixture<never> | NamedPointFixture<N>)[];
}

/** Names for a rectangle's corners. */
export interface CornerNames<N extends string> {
  readonly bottomLeft?: N;
  readonly bottomRight?: N;
  readonly topRight?: N;
  readonly topLeft?: N;
}

/**
 * A closed rectangle of on-curve corners, `width` by `height` from `x`, `y`,
 * drawn bottom-left, bottom-right, top-right, top-left as {@link square} is.
 */
export function rect<const N extends string = never>(
  x: number,
  y: number,
  width: number,
  height: number,
  names?: CornerNames<N>,
): ShapeFixture<NoInfer<N>> {
  return {
    closed: true,
    points: [
      corner(x, y, names?.bottomLeft),
      corner(x + width, y, names?.bottomRight),
      corner(x + width, y + height, names?.topRight),
      corner(x, y + height, names?.topLeft),
    ],
  };
}

/** A closed triangle of on-curve corners, in the order given. */
export function triangle<const N extends string = never>(
  a: ShapePoint<N>,
  b: ShapePoint<N>,
  c: ShapePoint<N>,
): ShapeFixture<NoInfer<N>> {
  return { closed: true, points: [onCurve(a), onCurve(b), onCurve(c)] };
}

/** An open straight line from `from` to `to`. */
export function line<const N extends string = never>(
  from: ShapePoint<N>,
  to: ShapePoint<N>,
): ShapeFixture<NoInfer<N>> {
  return { points: [onCurve(from), onCurve(to)] };
}

/** An open cubic curve from `start` to `end`, pulled by two off-curve controls. */
export function cubic<const N extends string = never>(
  start: ShapePoint<N>,
  control1: ShapePoint<N>,
  control2: ShapePoint<N>,
  end: ShapePoint<N>,
): ShapeFixture<NoInfer<N>> {
  return {
    points: [onCurve(start), offCurve(control1), offCurve(control2), onCurve(end)],
  };
}

/** A piece of {@link splitCubic}: 0 for the first. */
type CubicPiece = 0 | 1 | 2;

/** The names {@link splitCubic} gives: on-curve points `p0`…`p3`, each piece's controls `c0a`, `c0b`, `c1a`… */
export type CubicPieceName = `p${CubicPiece | 3}` | `c${CubicPiece}a` | `c${CubicPiece}b`;

/** What {@link splitCubic} makes: every point named, so each is a position. */
export interface SplitCubicFixture extends ShapeFixture<CubicPieceName> {
  readonly points: readonly NamedPointFixture<CubicPieceName>[];
}

/**
 * An open cubic curve from `start` to `end`, as {@link cubic} draws it, split
 * at each of `ts` in turn, each `t` measured along what is left: up to three
 * cubic pieces drawn exactly over the one curve. The on-curve points are named
 * `p0`, `p1`… and each piece's controls `c0a`, `c0b`, `c1a`….
 *
 * @example
 * const { p1 } = await editor.draw({ contours: [splitCubic([0, 0], [50, 100], [200, 100], [200, 0], 0.4)] });
 */
export function splitCubic(
  start: ShapePoint,
  control1: ShapePoint,
  control2: ShapePoint,
  end: ShapePoint,
  ...ts: number[]
): SplitCubicFixture {
  const pieces: CubicCurve[] = [];
  let rest = Curve.cubic(position(start), position(control1), position(control2), position(end));
  for (const t of ts) {
    const [left, right] = Curve.splitAt(rest, t) as [CubicCurve, CubicCurve];
    pieces.push(left);
    rest = right;
  }
  pieces.push(rest);
  if (pieces.length > 3) throw new Error("splitCubic names at most three pieces");

  return {
    points: [
      { ...position(start), name: "p0" },
      ...pieces.flatMap((piece, index): NamedPointFixture<CubicPieceName>[] => [
        { ...piece.c0, off: true, name: `c${index as CubicPiece}a` },
        { ...piece.c1, off: true, name: `c${index as CubicPiece}b` },
        { ...piece.p1, name: `p${(index + 1) as CubicPiece | 3}` },
      ]),
    ],
  };
}

function position(point: ShapePoint): Point2D {
  return isCorner(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y };
}

function corner<N extends string>(
  x: number,
  y: number,
  name: N | undefined,
): PointFixture<never> | NamedPointFixture<N> {
  return name === undefined ? [x, y] : { x, y, name };
}

function onCurve<N extends string>(
  point: ShapePoint<N>,
): PointFixture<never> | NamedPointFixture<N> {
  if (isCorner(point)) return point;
  const { x, y, name } = point;
  return name === undefined ? [x, y] : { x, y, name };
}

function offCurve<N extends string>(
  point: ShapePoint<N>,
): PointFixture<never> | NamedPointFixture<N> {
  if (isCorner(point)) return { x: point[0], y: point[1], off: true };
  const { x, y, name } = point;
  return name === undefined ? { x, y, off: true } : { x, y, off: true, name };
}
