import type { Point2D } from "@shift/geo";
import type { GridSettings } from "../../../types/grid";
import type {
  AxisSnap,
  GridPositionGuide,
  PositionCondition,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";

/**
 * Snaps a position to the nearest grid intersection, counted from the glyph origin.
 *
 * @remarks
 * The snap step on each axis is the spacing divided by the subdivisions, so
 * subdivision lines are snap targets too. It has no radius: every position
 * has a nearest intersection at most half a step away, and in a
 * {@link SnapSet} a nearer metric or point alignment still wins its axis.
 */
export class GridSnap implements PositionSnapProvider {
  readonly #step: Point2D;
  readonly #when: () => boolean;

  private constructor(step: Point2D, condition?: PositionCondition) {
    this.#step = step;
    this.#when = condition?.when ?? (() => true);
  }

  /**
   * @param settings - Grid spacing and subdivisions; whether snapping is on is the caller's decision.
   * @param condition - Per-frame switch, such as a held modifier suspending it.
   */
  static of(settings: GridSettings, condition?: PositionCondition): GridSnap {
    const step = {
      x: settings.spacingX / settings.subdivisions,
      y: settings.spacingY / settings.subdivisions,
    };
    if (!(step.x > 0) || !(step.y > 0) || !Number.isFinite(step.x) || !Number.isFinite(step.y)) {
      throw new Error("Grid snap steps must be positive finite numbers");
    }

    return new GridSnap(step, condition);
  }

  snap(point: Point2D): PositionSnap | null {
    if (!this.#when()) return null;

    const x = nearestMultiple(point.x, this.#step.x);
    const y = nearestMultiple(point.y, this.#step.y);

    return {
      x: axisSnap(x - point.x, { x, y: point.y }),
      y: axisSnap(y - point.y, { x: point.x, y }),
    };
  }
}

function nearestMultiple(value: number, step: number): number {
  // `+ 0` turns a negative zero, from rounding a small negative value, into zero.
  return Math.round(value / step) * step + 0;
}

/** One axis's correction, with a guide where the position lands on that axis's grid line. */
function axisSnap(offset: number, point: Point2D): AxisSnap {
  const guide: GridPositionGuide = { kind: "grid", point };
  return { offset, guides: [guide] };
}
