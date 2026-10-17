import type { DecomposedTransform, MatModel } from "@shift/geo";

/** An anchor as alignment reads it. */
export interface AlignmentAnchor {
  readonly name?: string;
  readonly x: number;
  readonly y: number;
}

/** A component already placed in the composite, with its glyph's own anchors. */
export interface PlacedComponent {
  readonly matrix: MatModel;
  readonly anchors: readonly AlignmentAnchor[];
}

/**
 * Returns the translation that puts a component's `_name` anchor on the
 * matching `name` anchor of the most recently placed earlier component.
 *
 * @remarks
 * A port of shift-font's `composite::anchor_aligned_offset`: the component's
 * first `_name` anchor that finds a match wins, and within one placed glyph
 * the last anchor with the name does.
 *
 * @returns null when no anchor pair matches.
 */
export function anchorAlignedOffset(
  placed: readonly PlacedComponent[],
  anchors: readonly AlignmentAnchor[],
): { x: number; y: number } | null {
  for (const anchor of anchors) {
    const target = anchor.name?.startsWith("_") ? anchor.name.slice(1) : "";
    if (target === "") continue;

    for (let index = placed.length - 1; index >= 0; index--) {
      const { matrix, anchors: placedAnchors } = placed[index]!;
      const match = placedAnchors.findLast((candidate) => candidate.name === target);
      if (!match) continue;
      const x = matrix.a * match.x + matrix.c * match.y + matrix.e;
      const y = matrix.b * match.x + matrix.d * match.y + matrix.f;
      return { x: x - anchor.x, y: y - anchor.y };
    }
  }
  return null;
}

/** One component of a composite, as it is now and as the workspace last accepted it. */
export interface FollowingComponent {
  readonly transform: DecomposedTransform;
  readonly matrix: MatModel;
  readonly acceptedTransform: DecomposedTransform;
  readonly acceptedMatrix: MatModel;
  /** The component glyph's own anchors now, and as last accepted. */
  readonly anchors: readonly AlignmentAnchor[];
  readonly acceptedAnchors: readonly AlignmentAnchor[];
}

const EPSILON = 1e-6;

/**
 * Returns where each component shows while an edit is in progress: attached
 * components follow the anchors they sat on.
 *
 * @remarks
 * The rule shift-font applies when an edit lands (`anchor_attachment`), so a
 * drag shows what the commit will do. A component is attached when, as last
 * accepted, its placement is exactly the translation that aligns it on its
 * anchors; it then shows aligned on the current anchors, in component order,
 * so marks stacked on a moving mark follow it too. A component the edit
 * itself moves was placed by hand and shows where it was put.
 */
export function followingPlacements(components: readonly FollowingComponent[]): MatModel[] {
  const placedAccepted: PlacedComponent[] = [];
  const placedShown: PlacedComponent[] = [];
  const shown: MatModel[] = [];
  for (const component of components) {
    let matrix = component.matrix;
    if (isAttached(component, placedAccepted)) {
      const offset = anchorAlignedOffset(placedShown, component.anchors);
      if (offset) matrix = { ...component.matrix, e: offset.x, f: offset.y };
    }
    shown.push(matrix);
    placedAccepted.push({ matrix: component.acceptedMatrix, anchors: component.acceptedAnchors });
    placedShown.push({ matrix, anchors: component.anchors });
  }
  return shown;
}

function isAttached(component: FollowingComponent, placed: readonly PlacedComponent[]): boolean {
  const accepted = component.acceptedTransform;
  if (!sameTransform(component.transform, accepted) || !isTranslation(accepted)) return false;
  const offset = anchorAlignedOffset(placed, component.acceptedAnchors);
  return (
    offset !== null &&
    Math.abs(accepted.translateX - offset.x) < EPSILON &&
    Math.abs(accepted.translateY - offset.y) < EPSILON
  );
}

function isTranslation(transform: DecomposedTransform): boolean {
  return (
    transform.rotation === 0 &&
    transform.scaleX === 1 &&
    transform.scaleY === 1 &&
    transform.skewX === 0 &&
    transform.skewY === 0
  );
}

function sameTransform(a: DecomposedTransform, b: DecomposedTransform): boolean {
  return (
    a.translateX === b.translateX &&
    a.translateY === b.translateY &&
    a.rotation === b.rotation &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.skewX === b.skewX &&
    a.skewY === b.skewY &&
    a.tCenterX === b.tCenterX &&
    a.tCenterY === b.tCenterY
  );
}
