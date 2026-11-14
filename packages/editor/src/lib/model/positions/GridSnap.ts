import type { Point2D } from "@shift/geo";
import type { GridSettings } from "../../../types/grid";
import type {
  AxisSnap,
  GridPositionGuide,
  PositionCondition,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";

/** Grid lines closer together than this on screen are left out, and the grid no longer snaps to them. */
export const MIN_GRID_LINE_GAP_PX = 12;

/**
 * The finest grid step one axis shows at the current zoom.
 *
 * @remarks
 * Drawing and snapping both follow it, so points only snap to lines that are
 * on screen: the subdivision step while its lines sit at least
 * {@link MIN_GRID_LINE_GAP_PX} apart, else the spacing, else nothing.
 *
 * @param spacing - Distance between grid lines, in the axis's units.
 * @param subdivisions - Divisions of each cell; 1 has no subdivision lines.
 * @param pxPerUnit - Screen pixels per unit along the axis.
 * @returns null when even the grid lines would sit too close together.
 */
export function visibleGridStep(
  spacing: number,
  subdivisions: number,
  pxPerUnit: number,
): number | null {
  if (!(spacing > 0) || !Number.isFinite(spacing)) return null;

  const subdivisionStep = spacing / subdivisions;
  if (subdivisionStep * pxPerUnit >= MIN_GRID_LINE_GAP_PX) return subdivisionStep;
  if (spacing * pxPerUnit >= MIN_GRID_LINE_GAP_PX) return spacing;

  return null;
}

/**
 * Snaps a position to the nearest visible grid line on each axis, counted from the glyph origin.
 *
 * @remarks
 * Each axis snaps to the finest grid lines on screen at the zoom it was built
 * for ({@link visibleGridStep}): subdivision lines when zoomed in, only the
 * grid lines further out, and not at all once the grid has faded away. It has
 * no radius: a position on a snapping axis has a nearest line at most half a
 * step away, and in a {@link SnapSet} a nearer metric or point alignment still
 * wins its axis.
 */
export class GridSnap implements PositionSnapProvider {
  readonly #step: GridSnapStep;
  readonly #when: () => boolean;

  private constructor(step: GridSnapStep, condition?: PositionCondition) {
    this.#step = step;
    this.#when = condition?.when ?? (() => true);
  }

  /**
   * @param settings - Grid spacing and subdivisions; whether snapping is on is the caller's decision.
   * @param pxPerUnit - Screen pixels per unit on each axis at the current zoom.
   * @param condition - Per-frame switch, such as a held modifier suspending it.
   * @returns null when the grid shows no lines on either axis at this zoom.
   */
  static of(
    settings: GridSettings,
    pxPerUnit: Point2D,
    condition?: PositionCondition,
  ): GridSnap | null {
    const step: GridSnapStep = {
      x: visibleGridStep(settings.spacingX, settings.subdivisions, pxPerUnit.x),
      y: visibleGridStep(settings.spacingY, settings.subdivisions, pxPerUnit.y),
    };
    if (step.x === null && step.y === null) return null;

    return new GridSnap(step, condition);
  }

  snap(point: Point2D): PositionSnap | null {
    if (!this.#when()) return null;

    return {
      x: this.#snapX(point),
      y: this.#snapY(point),
    };
  }

  #snapX(point: Point2D): AxisSnap | null {
    if (this.#step.x === null) return null;

    const x = nearestMultiple(point.x, this.#step.x);
    return axisSnap(x - point.x, { x, y: point.y });
  }

  #snapY(point: Point2D): AxisSnap | null {
    if (this.#step.y === null) return null;

    const y = nearestMultiple(point.y, this.#step.y);
    return axisSnap(y - point.y, { x: point.x, y });
  }
}

/** Snap step on each axis; null on an axis whose grid lines are not on screen. */
interface GridSnapStep {
  readonly x: number | null;
  readonly y: number | null;
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
