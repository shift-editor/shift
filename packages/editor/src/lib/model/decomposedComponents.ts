import { Point } from "@shift/glyph-state";
import type { ContourId } from "@shift/types";
import type { GlyphRenderContour, PlacedContours } from "../../types/glyphRender";
import { blendDecomposedGlyph as blend, type BlendedPoint } from "../wasm/generated/layouts";
import { RenderContour } from "./GlyphRenderModel";

/**
 * Blends every component occurrence of a decomposed glyph as each master
 * places it.
 *
 * @remarks
 * This is the outline a compiled font draws between the masters of a glyph
 * it decomposes. Runs shift-font's `placed_blend`, the rule native projection
 * uses: a mirrored placement reverses a closed contour, keeping its start
 * point, and that reversal decides which points blend. Compilers decompose a
 * glyph as a whole, so one occurrence whose masters don't line up leaves
 * every occurrence to the caller's fallback. Rust returns each blended point's
 * index in the first master's contour, and the point takes that point's
 * identity and type.
 *
 * @param occurrences - Per occurrence, each master's contours of its component
 * glyph and that master's transform for the occurrence.
 * @param weights - The root glyph's source weights, one per master in order.
 * @returns Each occurrence's blended contours, in order, or `null` when any
 * occurrence's masters don't line up point for point.
 */
export function blendDecomposedGlyph(
  occurrences: readonly (readonly PlacedContours[])[],
  weights: readonly number[],
): (readonly RenderContour[])[] | null {
  const blended = blend({ occurrences: occurrences.map((masters) => ({ masters })), weights });
  if (!blended) return null;

  return occurrences.map((masters, index) => {
    const [first] = masters;
    const points = blended[index] ?? [];
    return first ? placedContours(first.contours, points) : [];
  });
}

/** Attaches blended positions to the first master's points, in placed order. */
function placedContours(
  contours: readonly GlyphRenderContour[],
  blended: readonly BlendedPoint[],
): readonly RenderContour[] {
  let at = 0;
  return contours.map((contour) => {
    const points = contour.points.map(() => {
      const { sourceIndex, x, y } = blended[at++]!;
      return new Point({ ...contour.points[sourceIndex]!, x, y });
    });

    return new PlacedRenderContour(contour.id, contour.closed, points);
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
