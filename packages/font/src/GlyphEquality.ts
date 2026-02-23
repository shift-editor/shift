import type { GlyphSnapshot } from "@shift/types";

function areArraysEqual<T>(
  a: readonly T[],
  b: readonly T[],
  areItemsEqual: (left: T, right: T) => boolean,
): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!areItemsEqual(a[i], b[i])) {
      return false;
    }
  }

  return true;
}

function arePointSnapshotsEqual(
  a: GlyphSnapshot["contours"][number]["points"][number],
  b: GlyphSnapshot["contours"][number]["points"][number],
): boolean {
  return (
    a.id === b.id &&
    a.x === b.x &&
    a.y === b.y &&
    a.pointType === b.pointType &&
    a.smooth === b.smooth
  );
}

function areContourSnapshotsEqual(
  a: GlyphSnapshot["contours"][number],
  b: GlyphSnapshot["contours"][number],
): boolean {
  return (
    a.id === b.id &&
    a.closed === b.closed &&
    areArraysEqual(a.points, b.points, arePointSnapshotsEqual)
  );
}

function areAnchorSnapshotsEqual(
  a: GlyphSnapshot["anchors"][number],
  b: GlyphSnapshot["anchors"][number],
): boolean {
  return a.id === b.id && a.name === b.name && a.x === b.x && a.y === b.y;
}

function areRenderPointSnapshotsEqual(
  a: GlyphSnapshot["compositeContours"][number]["points"][number],
  b: GlyphSnapshot["compositeContours"][number]["points"][number],
): boolean {
  return a.x === b.x && a.y === b.y && a.pointType === b.pointType && a.smooth === b.smooth;
}

function areRenderContourSnapshotsEqual(
  a: GlyphSnapshot["compositeContours"][number],
  b: GlyphSnapshot["compositeContours"][number],
): boolean {
  return a.closed === b.closed && areArraysEqual(a.points, b.points, areRenderPointSnapshotsEqual);
}

/**
 * Compare two glyph snapshots by value using domain-specific field checks.
 *
 * This avoids generic deep-equal traversal while still ensuring drag commits
 * only produce history entries when a glyph actually changed.
 */
export function areGlyphSnapshotsEqual(a: GlyphSnapshot, b: GlyphSnapshot): boolean {
  if (a === b) return true;

  return (
    a.unicode === b.unicode &&
    a.name === b.name &&
    a.xAdvance === b.xAdvance &&
    a.activeContourId === b.activeContourId &&
    areArraysEqual(a.contours, b.contours, areContourSnapshotsEqual) &&
    areArraysEqual(a.anchors, b.anchors, areAnchorSnapshotsEqual) &&
    areArraysEqual(a.compositeContours, b.compositeContours, areRenderContourSnapshotsEqual)
  );
}
