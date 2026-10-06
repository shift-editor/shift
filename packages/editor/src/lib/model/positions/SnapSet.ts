import { Vec2, type Point2D } from "@shift/geo";
import type {
  AxisSnap,
  PositionCondition,
  PositionGuide,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";

/**
 * Composes snap providers so the nearest correction wins on each axis.
 *
 * @remarks
 * Distance alone decides; provider order never does. Providers that propose the
 * same correction on an axis all contribute their guides, so coincident targets
 * stay visible together.
 */
export class SnapSet implements PositionSnapProvider {
  readonly #providers: readonly PositionSnapProvider[];
  readonly #when: () => boolean;

  private constructor(providers: readonly PositionSnapProvider[], condition?: PositionCondition) {
    this.#providers = providers;
    this.#when = condition?.when ?? (() => true);
  }

  /**
   * @param providers - Snap sources compared by distance on each axis.
   * @param condition - Per-frame switch for the whole set, such as a held modifier suspending it.
   */
  static nearest(
    providers: readonly PositionSnapProvider[],
    condition?: PositionCondition,
  ): SnapSet {
    return new SnapSet([...providers], condition);
  }

  snap(point: Point2D): PositionSnap | null {
    if (!this.#when()) return null;

    let x: AxisSnap | null = null;
    let y: AxisSnap | null = null;

    for (const provider of this.#providers) {
      const snap = provider.snap(point);
      if (!snap) continue;

      x = nearerAxisSnap(x, snap.x);
      y = nearerAxisSnap(y, snap.y);
    }

    if (!x && !y) return null;
    return { x, y };
  }
}

/** The closer of two axis corrections, merging guides when both propose the same offset. */
export function nearerAxisSnap(
  current: AxisSnap | null,
  candidate: AxisSnap | null,
): AxisSnap | null {
  if (!candidate) return current;
  if (!current) return candidate;

  const currentDistance = Math.abs(current.offset);
  const candidateDistance = Math.abs(candidate.offset);
  if (candidateDistance < currentDistance) return candidate;

  const agrees = candidate.offset === current.offset;
  if (!agrees) return current;

  return {
    offset: current.offset,
    guides: [...current.guides, ...candidate.guides],
  };
}

/**
 * Combines a snap's axis corrections into one offset, with guides drawn at the final position.
 *
 * @remarks
 * Each axis records its guides before the other axis corrects, so x guides shift by the
 * y offset and y guides by the x offset.
 */
export function settleSnap(snap: PositionSnap): { offset: Point2D; guides: PositionGuide[] } {
  const { x, y } = snap;
  const shiftX = { x: 0, y: y?.offset ?? 0 };
  const shiftY = { x: x?.offset ?? 0, y: 0 };

  return {
    offset: { x: x?.offset ?? 0, y: y?.offset ?? 0 },
    guides: [
      ...(x?.guides ?? []).map((guide) => settleGuide(guide, shiftX)),
      ...(y?.guides ?? []).map((guide) => settleGuide(guide, shiftY)),
    ],
  };
}

/** Moves a guide's snapped end by a correction applied after it was recorded; targets stay put. */
function settleGuide(guide: PositionGuide, shift: Point2D): PositionGuide {
  switch (guide.kind) {
    case "metric":
      return { ...guide, x: guide.x + shift.x };
    case "alignment":
      return { ...guide, point: Vec2.add(guide.point, shift) };
    case "direction":
      return guide;
  }
}
