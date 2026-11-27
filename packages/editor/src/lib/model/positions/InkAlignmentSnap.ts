import type { Point2D } from "@shift/geo";
import { ascending, comparing, orderBy } from "@shift/types";
import type { AxisSnap, PositionSnap, PositionSnapProvider } from "../../../types/positionEdit";

/**
 * Snaps a position's x and y independently onto the ink edges of stroked contours.
 *
 * @remarks
 * Works identically to {@link PointAlignmentSnap} but emits `"inkAlignment"` guides
 * so the renderer can draw a distinguishing "ink" tag. The targets are on-curve
 * points and parametric extrema of solved stroke outlines, computed by Rust.
 */
export class InkAlignmentSnap implements PositionSnapProvider {
  readonly #targets: readonly Point2D[];
  readonly #byX: AxisIndex;
  readonly #byY: AxisIndex;
  readonly #radius: number;

  private constructor(targets: readonly Point2D[], byX: AxisIndex, byY: AxisIndex, radius: number) {
    this.#targets = targets;
    this.#byX = byX;
    this.#byY = byY;
    this.#radius = radius;
  }

  /**
   * @param targets - Ink on-curve positions and extrema that stay put during the edit.
   * @param radius - Font-unit distance within which an axis aligns.
   */
  static to(targets: readonly Point2D[], radius: number): InkAlignmentSnap {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error("Ink alignment radius must be a non-negative finite number");
    }

    const copied = targets.map(({ x, y }) => ({ x, y }));
    return new InkAlignmentSnap(
      copied,
      AxisIndex.of(copied, "x"),
      AxisIndex.of(copied, "y"),
      radius,
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
    return { x, y };
  }

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
        return { kind: "inkAlignment" as const, target, point: align(target).aligned };
      }),
    };
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

  nearest(value: number, radius: number): number[] {
    const values = this.#values;
    const indices = this.#indices;
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

    const found: number[] = [];
    for (let slot = best; slot < values.length && values[slot] === values[best]; slot++) {
      found.push(indices[slot]!);
    }
    return found;
  }

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
