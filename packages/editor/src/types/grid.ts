import type { Grid as FontGrid } from "@shift/types";
import type { Signal } from "../lib/signals/index";

/**
 * The cells of the canvas grid: line spacing on each axis and how many
 * divisions each cell takes, as the font stores them.
 *
 * @remarks
 * In font units and anchored at the edited glyph's origin: lines fall on
 * every multiple of the spacing, counted from (0, 0) at the baseline and left
 * sidebearing. Subdivision lines draw lighter than grid lines, and snapping
 * lands on them too, so 2 subdivisions put a snap target at every half step.
 */
export type GridCells = FontGrid;

/** Whether the canvas grid draws and snaps: a choice of the window, never saved. */
export interface GridView {
  /** Whether the grid draws behind the edited glyph. */
  readonly visible: boolean;
  /** Whether dragged and placed positions snap to grid intersections. */
  readonly snap: boolean;
}

/** How the canvas grid is laid out and whether it draws and snaps. */
export type GridSettings = Readonly<GridCells> & GridView;

/** Settings to change on the grid; fields left out keep their value. */
export type GridSettingsChange = Partial<GridSettings>;

/** Where the font keeps its grid, and how to change it. */
export interface GridStorage {
  /** The font's stored grid; null when it stores none. */
  readonly gridCell: Signal<GridCells | null>;
  /** Moves on every change to the stored grid, an undo back to an earlier grid included. */
  readonly revisionCell: Signal<number>;
  /** Writes `cells` as the font's grid, as one undoable edit. */
  write(cells: GridCells): void;
}
