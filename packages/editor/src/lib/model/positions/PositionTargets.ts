import type { AnchorId, PointId } from "@shift/types";

/**
 * Point and anchor identities transformed together by one position edit.
 *
 * @remarks
 * Both lists are always present; an empty list means "none of that kind", so
 * readers never fall back with `?? []`. Build one with {@link PositionTargets.points},
 * {@link PositionTargets.anchors} or the constructor; {@link PositionTargets.NONE}
 * targets nothing.
 */
export class PositionTargets {
  /** Targets nothing. */
  static readonly NONE = new PositionTargets([], []);

  /**
   * @param points - Points to move, in the caller's order.
   * @param anchors - Anchors to move, in the caller's order.
   */
  constructor(
    readonly points: readonly PointId[],
    readonly anchors: readonly AnchorId[],
  ) {}

  /** Targets only `points`. */
  static points(points: readonly PointId[]): PositionTargets {
    return new PositionTargets(points, []);
  }

  /** Targets only `anchors`. */
  static anchors(anchors: readonly AnchorId[]): PositionTargets {
    return new PositionTargets([], anchors);
  }

  /** Whether there is nothing to move. */
  get isEmpty(): boolean {
    return this.points.length === 0 && this.anchors.length === 0;
  }

  /** Whether any anchor is targeted. */
  get hasAnchors(): boolean {
    return this.anchors.length > 0;
  }
}
