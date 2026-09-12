import type { GlyphStructure } from "@shift/types";

/**
 * Compares ordered glyph topology and metadata independently of object identity.
 *
 * @param a - First immutable structure, including authored identities.
 * @param b - Second structure, possibly deserialized from a workspace echo.
 * @returns Whether both structures interpret the same numeric value layout and
 *   carry identical metadata. Coordinates are not part of this comparison.
 */
export function glyphStructuresEqual(a: GlyphStructure, b: GlyphStructure): boolean {
  if (a === b) return true;
  if (
    a.contours.length !== b.contours.length ||
    a.anchors.length !== b.anchors.length ||
    a.components.length !== b.components.length
  )
    return false;

  for (let index = 0; index < a.contours.length; index++) {
    const contour = a.contours[index]!;
    const other = b.contours[index]!;
    if (contour === other) continue;
    if (
      contour.id !== other.id ||
      contour.closed !== other.closed ||
      contour.points.length !== other.points.length
    )
      return false;

    for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex++) {
      const point = contour.points[pointIndex]!;
      const otherPoint = other.points[pointIndex]!;
      if (
        point.id !== otherPoint.id ||
        point.pointType !== otherPoint.pointType ||
        point.smooth !== otherPoint.smooth
      )
        return false;
    }
  }

  for (let index = 0; index < a.anchors.length; index++) {
    const anchor = a.anchors[index]!;
    const other = b.anchors[index]!;
    if (anchor.id !== other.id || anchor.name !== other.name) return false;
  }

  for (let index = 0; index < a.components.length; index++) {
    const component = a.components[index]!;
    const other = b.components[index]!;
    if (
      component.id !== other.id ||
      component.baseGlyphId !== other.baseGlyphId ||
      component.baseGlyphName !== other.baseGlyphName
    )
      return false;
  }

  return true;
}
