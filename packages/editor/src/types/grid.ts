/**
 * How the canvas grid is laid out and whether it draws and snaps.
 *
 * @remarks
 * The grid is in font units and anchored at the edited glyph's origin: lines
 * fall on every multiple of the spacing, counted from (0, 0) at the baseline
 * and left sidebearing. Session state for now; it is not saved in the font.
 */
export interface GridSettings {
  /** Distance between vertical grid lines, in font units. */
  readonly spacingX: number;
  /** Distance between horizontal grid lines, in font units. */
  readonly spacingY: number;
  /**
   * Divisions of each grid cell along each axis; 1 has none.
   *
   * @remarks
   * Subdivision lines draw lighter than grid lines, and snapping lands on
   * them too, so 2 puts a snap target at every half step.
   */
  readonly subdivisions: number;
  /** Whether the grid draws behind the edited glyph. */
  readonly visible: boolean;
  /** Whether dragged and placed positions snap to grid intersections. */
  readonly snap: boolean;
}

/** Settings to change on the grid; fields left out keep their value. */
export type GridSettingsChange = Partial<GridSettings>;
