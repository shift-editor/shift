/**
 * Questions tests ask of an {@link Outline} read. Each is a pure function of
 * the data a read returns, so it answers the same for either driver's result.
 *
 * @example
 * const fitted = shape(await editor.outline());
 * await editor.undo();
 * …
 * expect(shape(await editor.outline())).toEqual(fitted);
 *
 * This file imports types only, so `apps/desktop/e2e` can import it.
 */
import type { PointType } from "@shift/types";
import type { Outline, OutlinePoint } from "./reads";

/** One point of an {@link OutlineShape}: an outline point without its id. */
export type PointShape = Omit<OutlinePoint, "id">;

/** One contour of an {@link OutlineShape}: whether it is closed, and its points in order. */
export interface ContourShape {
  readonly closed: boolean;
  readonly points: readonly PointShape[];
}

/** An outline without ids: what it draws, whichever contours and points draw it. */
export type OutlineShape = readonly ContourShape[];

/**
 * `outline` without its contour and point ids, so two outlines compare equal
 * when they draw the same contours, points and types, as after an edit that
 * replaces points.
 */
export function shape(outline: Outline): OutlineShape {
  return outline.map((contour) => ({
    closed: contour.closed,
    points: contour.points.map(({ x, y, pointType, smooth }) => ({ x, y, pointType, smooth })),
  }));
}

/** Each point's type, in order. */
export function pointTypes(points: readonly Pick<OutlinePoint, "pointType">[]): PointType[] {
  return points.map(({ pointType }) => pointType);
}
