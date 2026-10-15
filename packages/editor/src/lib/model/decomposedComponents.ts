import { Mat, type MatModel } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { ContourId } from "@shift/types";
import type { GlyphRenderContour, PlacedContours } from "../../types/glyphRender";
import { RenderContour } from "./GlyphRenderModel";

/**
 * Blends one component occurrence's outline as each master places it.
 *
 * @remarks
 * This is the outline a compiled font draws between the masters of a glyph
 * it decomposes. Contour and point identities come from the first master.
 *
 * @returns The blended contours, or `null` when the masters' outlines don't
 * line up point for point.
 */
export function blendPlacedContours(
  masters: readonly PlacedContours[],
): readonly RenderContour[] | null {
  const [first] = masters;
  if (!first || !masters.every((master) => sameStructure(master, first))) return null;

  const placed = masters.map((master) =>
    master.contours.map((contour) => placedPoints(contour, master.matrix)),
  );

  return first.contours.map((contour, contourIndex) => {
    const points = (placed[0]?.[contourIndex] ?? []).map((point, pointIndex) => {
      let x = 0;
      let y = 0;
      masters.forEach((master, masterIndex) => {
        const source = placed[masterIndex]?.[contourIndex]?.[pointIndex];
        if (!source) return;

        x += master.weight * source.x;
        y += master.weight * source.y;
      });

      return new Point({ ...point, x, y });
    });

    return new PlacedRenderContour(contour.id, contour.closed, points);
  });
}

/**
 * Places a contour's points as a compiler decomposes them: a mirrored
 * placement reverses a closed contour, keeping its start point, so the
 * contour keeps its direction. The reversal decides which points blend
 * between masters.
 */
function placedPoints(contour: GlyphRenderContour, matrix: MatModel): readonly Point[] {
  const points = contour.points.map(
    (point) => new Point({ ...point, ...Mat.applyToPoint(matrix, point) }),
  );
  const mirrored = matrix.a * matrix.d - matrix.b * matrix.c < 0;
  if (!mirrored || !contour.closed) return points;

  const [start, ...rest] = points;
  return start ? [start, ...rest.reverse()] : points;
}

function sameStructure(a: PlacedContours, b: PlacedContours): boolean {
  if (a.contours.length !== b.contours.length) return false;

  return a.contours.every((contour, index) => {
    const other = b.contours[index];
    return other?.closed === contour.closed && other.points.length === contour.points.length;
  });
}

/** Render contour holding already-placed, blended points. */
class PlacedRenderContour extends RenderContour {
  readonly id: ContourId;
  readonly closed: boolean;
  readonly points: readonly Point[];

  constructor(id: ContourId, closed: boolean, points: readonly Point[]) {
    super();
    this.id = id;
    this.closed = closed;
    this.points = points;
  }
}
