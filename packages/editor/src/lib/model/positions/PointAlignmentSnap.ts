import type { Point2D } from "@shift/geo";
import { ascending, comparing, orderBy } from "@shift/types";
import type {
  AxisSnap,
  PositionGuide,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";

/**
 * Snaps a position's x and y independently onto those of nearby stationary points.
 *
 * @remarks
 * Targets are sorted along each axis once, so a snap looks only at the targets
 * within the radius on that axis rather than at all of them: a dragged group
 * snaps each of its points on every frame against tens of thousands of
 * targets in a large glyph. Ties resolve as a scan of the targets in order
 * would: the nearest coordinate wins, the one holding the earlier target when
 * two are equally near, and every target on it guides, in order.
 */
export class PointAlignmentSnap implements PositionSnapProvider {
  readonly #targets: readonly Point2D[];
  readonly #byX: AxisIndex;
  readonly #byY: AxisIndex;
  readonly #marked: readonly Point2D[];
  readonly #radius: number;

  private constructor(
    targets: readonly Point2D[],
    byX: AxisIndex,
    byY: AxisIndex,
    marked: readonly Point2D[],
    radius: number,
  ) {
    this.#targets = targets;
    this.#byX = byX;
    this.#byY = byY;
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

    const copied = copyPoints(targets);
    return new PointAlignmentSnap(
      copied,
      AxisIndex.of(copied, "x"),
      AxisIndex.of(copied, "y"),
      [],
      radius,
    );
  }

  /**
   * Adds positions that never pull a snap but are guided when they already sit on one.
   *
   * @param points - Stationary positions, such as a dragged group's own edge ends, that are
   *   marked only when an axis snaps to a real target and they share its exact coordinate.
   * @returns A new provider with the same targets and radius.
   */
  marking(points: readonly Point2D[]): PointAlignmentSnap {
    return new PointAlignmentSnap(
      this.#targets,
      this.#byX,
      this.#byY,
      copyPoints(points),
      this.#radius,
    );
  }

  snap(point: Point2D): PositionSnap | null {
    const x = this.#axisSnap(this.#byX.nearest(point.x, this.#radius), (target) => ({
      offset: target.x - point.x,
      aligned: { x: target.x, y: point.y },
    }));
    const y = this.#axisSnap(this.#byY.nearest(point.y, this.#radius), (target) => ({
      offset: target.y - point.y,
      aligned: { x: point.x, y: target.y },
    }));

    if (!x && !y) return null;
    return { x: x && this.#withMarked(x, "x"), y: y && this.#withMarked(y, "y") };
  }

  /** One axis's snap onto the targets at `indices`, which share the nearest coordinate. */
  #axisSnap(
    indices: readonly number[],
    align: (target: Point2D) => { offset: number; aligned: Point2D },
  ): AxisSnap | null {
    const first = indices[0];
    if (first === undefined) return null;

    return {
      offset: align(this.#targets[first]!).offset,
      guides: indices.map((index) => {
        const target = this.#targets[index]!;
        return { kind: "alignment", target, point: align(target).aligned };
      }),
    };
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

/**
 * Points' coordinates on one axis, sorted, each with the point's place in its
 * list; equal coordinates keep list order.
 */
class AxisIndex {
  readonly #values: Float64Array;
  readonly #indices: Uint32Array;

  private constructor(values: Float64Array, indices: Uint32Array) {
    this.#values = values;
    this.#indices = indices;
  }

  static of(points: readonly Point2D[], axis: "x" | "y"): AxisIndex {
    const indices = Uint32Array.from(points.keys()).sort(
      orderBy(
        comparing((index) => points[index]![axis], ascending),
        ascending,
      ),
    );
    return new AxisIndex(
      Float64Array.from(indices, (index) => points[index]![axis]),
      indices,
    );
  }

  /**
   * Places in the list, in list order, of the points at the coordinate nearest
   * `value` within `radius`. When two coordinates are equally near, the one
   * holding the earlier point wins, as a scan of the list in order would pick.
   */
  nearest(value: number, radius: number): number[] {
    const values = this.#values;
    const indices = this.#indices;
    // A little wider than `radius`, so rounding in the window never drops a point.
    const slack = (Math.abs(value) + radius) * Number.EPSILON * 4;
    const max = value + radius + slack;

    let best = -1;
    let bestDistance = Infinity;
    for (let slot = this.#lowerBound(value - radius - slack); slot < values.length; slot++) {
      if (values[slot]! > max) break;
      const distance = Math.abs(values[slot]! - value);
      if (distance > radius) continue;
      if (
        distance < bestDistance ||
        (distance === bestDistance && indices[slot]! < indices[best]!)
      ) {
        best = slot;
        bestDistance = distance;
      }
    }
    if (best < 0) return [];

    // The winner is the first slot of its coordinate, whose points follow in list order.
    const found: number[] = [];
    for (let slot = best; slot < values.length && values[slot] === values[best]; slot++) {
      found.push(indices[slot]!);
    }
    return found;
  }

  /** The first slot whose value is at least `min`. */
  #lowerBound(min: number): number {
    let low = 0;
    let high = this.#values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#values[middle]! < min) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

function copyPoints(points: readonly Point2D[]): Point2D[] {
  return points.map(({ x, y }) => ({ x, y }));
}
