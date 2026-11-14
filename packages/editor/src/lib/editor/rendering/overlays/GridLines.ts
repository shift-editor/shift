import type { Bounds } from "@shift/geo";
import type { GridSettings } from "../../../../types/grid";
import type { Canvas } from "../Canvas";

/** Lines closer together than this on screen are left out, so the grid never turns into a wash. */
export const MIN_GRID_LINE_GAP_PX = 6;

/** Grid and subdivision line positions along one axis, in the units the grid is measured in. */
export interface GridAxisLines {
  /** Lines on every multiple of the spacing. */
  readonly major: readonly number[];
  /** Lines between them, one per subdivision; empty when they would sit too close together. */
  readonly minor: readonly number[];
}

/**
 * Draws the canvas grid across the visible area, anchored at the units' origin.
 *
 * @remarks
 * Drawn in the edited glyph's units, so the lines fall on multiples of the
 * spacing counted from the glyph origin. Subdivision lines draw lighter, and
 * either kind is skipped when it would be closer than {@link MIN_GRID_LINE_GAP_PX}
 * on screen.
 */
export class GridLines {
  /**
   * @param canvas - Canvas already transformed into the glyph's units.
   * @param settings - Spacing and subdivisions; whether the grid is visible is the caller's decision.
   */
  draw(canvas: Canvas, settings: GridSettings): void {
    const visible = canvas.visibleBounds(0);
    const { a, b, c, d } = canvas.transform;
    const pxPerUnitX = Math.hypot(a, b);
    const pxPerUnitY = Math.hypot(c, d);
    const columns = gridAxisLines(
      visible.min.x,
      visible.max.x,
      settings.spacingX,
      settings.subdivisions,
      pxPerUnitX,
    );
    const rows = gridAxisLines(
      visible.min.y,
      visible.max.y,
      settings.spacingY,
      settings.subdivisions,
      pxPerUnitY,
    );
    const { color, subdivisionColor, widthPx } = canvas.theme.grid;

    strokeLines(canvas, visible, columns.minor, rows.minor, subdivisionColor, widthPx);
    strokeLines(canvas, visible, columns.major, rows.major, color, widthPx);
  }
}

/**
 * The grid lines one axis shows between `min` and `max`.
 *
 * @param spacing - Distance between grid lines, in the axis's units.
 * @param subdivisions - Divisions of each cell; 1 has no subdivision lines.
 * @param pxPerUnit - Screen pixels per unit along the axis, which decides what is too dense.
 */
export function gridAxisLines(
  min: number,
  max: number,
  spacing: number,
  subdivisions: number,
  pxPerUnit: number,
): GridAxisLines {
  if (!(spacing > 0) || spacing * pxPerUnit < MIN_GRID_LINE_GAP_PX) {
    return { major: [], minor: [] };
  }

  const step = spacing / subdivisions;
  const showMinor = subdivisions > 1 && step * pxPerUnit >= MIN_GRID_LINE_GAP_PX;
  const lineStep = showMinor ? step : spacing;
  const perMajor = showMinor ? subdivisions : 1;
  const major: number[] = [];
  const minor: number[] = [];

  for (let index = Math.ceil(min / lineStep); index * lineStep <= max; index++) {
    const position = index * lineStep;
    if (index % perMajor === 0) major.push(position);
    else minor.push(position);
  }

  return { major, minor };
}

function strokeLines(
  canvas: Canvas,
  visible: Bounds,
  columns: readonly number[],
  rows: readonly number[],
  color: string,
  widthPx: number,
): void {
  if (columns.length === 0 && rows.length === 0) return;

  const ctx = canvas.ctx;
  ctx.beginPath();
  for (const x of columns) {
    ctx.moveTo(x, visible.min.y);
    ctx.lineTo(x, visible.max.y);
  }
  for (const y of rows) {
    ctx.moveTo(visible.min.x, y);
    ctx.lineTo(visible.max.x, y);
  }
  canvas.stroke(color, widthPx);
}
