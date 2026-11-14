import { signal, type Signal, type WritableSignal } from "../signals/index";
import type { GridSettings, GridSettingsChange } from "../../types/grid";

/** The grid a new session starts with: 100-unit cells, hidden and not snapping. */
export const DEFAULT_GRID_SETTINGS: GridSettings = {
  spacingX: 100,
  spacingY: 100,
  subdivisions: 1,
  visible: false,
  snap: false,
};

/** The most divisions one grid cell takes along an axis. */
export const MAX_GRID_SUBDIVISIONS = 16;

/**
 * Holds the canvas grid's settings for one editor session.
 *
 * @remarks
 * Readers subscribe to {@link settingsCell}; the grid overlay and snapping
 * both read it, so a change redraws the grid and the next gesture snaps to
 * it. Nothing here is saved with the font.
 */
export class Grid {
  readonly #settingsCell: WritableSignal<GridSettings>;
  readonly settingsCell: Signal<GridSettings>;

  constructor(initial: GridSettings = DEFAULT_GRID_SETTINGS) {
    this.#settingsCell = signal<GridSettings>(normalized(initial, DEFAULT_GRID_SETTINGS), {
      name: "editor.grid.settings",
      equals: sameGridSettings,
    });
    this.settingsCell = this.#settingsCell;
  }

  /** The current settings, read without subscribing. */
  get settings(): GridSettings {
    return this.#settingsCell.peek();
  }

  /**
   * Changes some settings and keeps the rest.
   *
   * @remarks
   * A spacing that is not a positive finite number keeps the current one;
   * subdivisions round to a whole number from 1 to {@link MAX_GRID_SUBDIVISIONS}.
   */
  update(change: GridSettingsChange): void {
    const current = this.settings;
    this.#settingsCell.set(normalized({ ...current, ...change }, current));
  }

  /** Turns snapping to the grid on or off. */
  toggleSnap(): void {
    this.update({ snap: !this.settings.snap });
  }

  /** Shows or hides the grid. */
  toggleVisible(): void {
    this.update({ visible: !this.settings.visible });
  }
}

function normalized(settings: GridSettings, fallback: GridSettings): GridSettings {
  return {
    spacingX: validSpacing(settings.spacingX) ? settings.spacingX : fallback.spacingX,
    spacingY: validSpacing(settings.spacingY) ? settings.spacingY : fallback.spacingY,
    subdivisions: clampedSubdivisions(settings.subdivisions, fallback.subdivisions),
    visible: settings.visible,
    snap: settings.snap,
  };
}

function validSpacing(spacing: number): boolean {
  return Number.isFinite(spacing) && spacing > 0;
}

function clampedSubdivisions(subdivisions: number, fallback: number): number {
  if (!Number.isFinite(subdivisions)) return fallback;

  return Math.min(MAX_GRID_SUBDIVISIONS, Math.max(1, Math.round(subdivisions)));
}

function sameGridSettings(a: GridSettings, b: GridSettings): boolean {
  return (
    a.spacingX === b.spacingX &&
    a.spacingY === b.spacingY &&
    a.subdivisions === b.subdivisions &&
    a.visible === b.visible &&
    a.snap === b.snap
  );
}
