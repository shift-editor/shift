import type { Point2D } from "@shift/geo";
import type {
  AxisSnap,
  PositionGuide,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";
import { nearerAxisSnap } from "./SnapSet";

/** Snaps a position's x and y independently onto those of nearby stationary points. */
export class PointAlignmentSnap implements PositionSnapProvider {
  readonly #targets: readonly Point2D[];
  readonly #marked: readonly Point2D[];
  readonly #radius: number;

  private constructor(targets: readonly Point2D[], marked: readonly Point2D[], radius: number) {
    this.#targets = targets;
    this.#marked = marked;
    this.#radius = radius;
  }

  /**
   * @param targets - Glyph-local positions that stay put during the edit.
   * @param radius - Font-unit distance within which an axis aligns.
   */
  static to(targets: readonly Point2D[], radius: number): PointAlignmentSnap {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error("Point alignment radius must be a non-negative finite number");
    }

    return new PointAlignmentSnap(copyPoints(targets), [], radius);
  }

  /**
   * Adds positions that never pull a snap but are guided when they already sit on one.
   *
   * @param points - Stationary positions, such as a dragged group's own edge ends, that are
   *   marked only when an axis snaps to a real target and they share its exact coordinate.
   * @returns A new provider with the same targets and radius.
   */
  marking(points: readonly Point2D[]): PointAlignmentSnap {
    return new PointAlignmentSnap(this.#targets, copyPoints(points), this.#radius);
  }

  snap(point: Point2D): PositionSnap | null {
    let x: AxisSnap | null = null;
    let y: AxisSnap | null = null;

    for (const target of this.#targets) {
      const offsetX = target.x - point.x;
      if (Math.abs(offsetX) <= this.#radius) {
        const aligned = { x: target.x, y: point.y };
        x = nearerAxisSnap(x, {
          offset: offsetX,
          guides: [{ kind: "alignment", target, point: aligned }],
        });
      }

      const offsetY = target.y - point.y;
      if (Math.abs(offsetY) <= this.#radius) {
        const aligned = { x: point.x, y: target.y };
        y = nearerAxisSnap(y, {
          offset: offsetY,
          guides: [{ kind: "alignment", target, point: aligned }],
        });
      }
    }

    if (!x && !y) return null;
    return { x: x && this.#withMarked(x, "x"), y: y && this.#withMarked(y, "y") };
  }

  /** Adds guides for marked points lying exactly on the line this axis snapped to. */
  #withMarked(snap: AxisSnap, axis: "x" | "y"): AxisSnap {
    const line = snap.guides.find((guide) => guide.kind === "alignment");
    if (!line || line.kind !== "alignment") return snap;

    const value = line.point[axis];
    const marked: PositionGuide[] = this.#marked
      .filter((point) => point[axis] === value)
      .map((target) => ({ kind: "alignment", target, point: line.point }));

    return marked.length === 0 ? snap : { ...snap, guides: [...snap.guides, ...marked] };
  }
}

function copyPoints(points: readonly Point2D[]): Point2D[] {
  return points.map(({ x, y }) => ({ x, y }));
}
