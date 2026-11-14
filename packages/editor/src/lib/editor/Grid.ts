import { computed, signal, type Signal, type WritableSignal } from "../signals/index";
import type {
  GridCells,
  GridSettings,
  GridSettingsChange,
  GridStorage,
  GridView,
} from "../../types/grid";

/** The cells a font without a stored grid is drawn on: 100 units, no subdivisions. */
export const DEFAULT_GRID_CELLS: GridCells = {
  spacingX: 100,
  spacingY: 100,
  subdivisions: 1,
};

/** The grid a new session starts with: the default cells, hidden and not snapping. */
export const DEFAULT_GRID_SETTINGS: GridSettings = {
  ...DEFAULT_GRID_CELLS,
  visible: false,
  snap: false,
};

/** The most divisions one grid cell takes along an axis. */
export const MAX_GRID_SUBDIVISIONS = 16;

/** A cell change written to the font, shown until the font's grid next changes. */
interface PendingCells {
  readonly cells: GridCells;
  /** The stored grid's revision when the change was written; once it moves, the font's grid wins. */
  readonly at: number;
}

/**
 * Holds the canvas grid's settings for one editor session.
 *
 * @remarks
 * Readers subscribe to {@link settingsCell}; the grid overlay and snapping
 * both read it, so a change redraws the grid and the next gesture snaps to
 * it.
 *
 * The cells (spacing and subdivisions) belong to the font: they come from
 * its stored grid, and a change to them is a font edit, saved and undone
 * with the font. Until the font echoes a change back, the change shows
 * already. Whether the grid is shown or snapped to belongs to the window and
 * is never saved. Without storage, as in a read-only preview, cell changes
 * last for the session.
 */
export class Grid {
  readonly #viewCell: WritableSignal<GridView>;
  readonly #pendingCell: WritableSignal<PendingCells | null>;
  readonly #storage: GridStorage | null;
  readonly settingsCell: Signal<GridSettings>;

  /**
   * @param storage - The font's stored grid and how to write it; null keeps
   * cell changes in the session.
   */
  constructor(storage: GridStorage | null = null) {
    this.#storage = storage;
    this.#viewCell = signal<GridView>(
      { visible: DEFAULT_GRID_SETTINGS.visible, snap: DEFAULT_GRID_SETTINGS.snap },
      { name: "editor.grid.view" },
    );
    this.#pendingCell = signal<PendingCells | null>(null, { name: "editor.grid.pending" });
    this.settingsCell = computed(
      () => {
        const cells = shownCells(
          this.#pendingCell.value,
          storage?.revisionCell.value ?? 0,
          storage?.gridCell.value ?? null,
        );
        return { ...cells, ...this.#viewCell.value };
      },
      { name: "editor.grid.settings", equals: sameGridSettings },
    );
  }

  /** The current settings, read without subscribing. */
  get settings(): GridSettings {
    return this.settingsCell.peek();
  }

  /**
   * Changes some settings and keeps the rest.
   *
   * @remarks
   * A spacing that is not a positive finite number keeps the current one;
   * subdivisions round to a whole number from 1 to {@link MAX_GRID_SUBDIVISIONS}.
   * A change to the cells is written to the font as one undoable edit.
   */
  update(change: GridSettingsChange): void {
    const current = this.settings;
    const next = normalized({ ...current, ...change }, current);
    this.#viewCell.set({ visible: next.visible, snap: next.snap });
    if (sameCells(next, current)) return;

    const cells: GridCells = {
      spacingX: next.spacingX,
      spacingY: next.spacingY,
      subdivisions: next.subdivisions,
    };
    this.#pendingCell.set({ cells, at: this.#storage?.revisionCell.peek() ?? 0 });
    this.#storage?.write(cells);
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

/** The cells shown: a pending change until the stored grid's revision moves, then the stored grid. */
function shownCells(
  pending: PendingCells | null,
  revision: number,
  stored: GridCells | null,
): GridCells {
  if (pending && pending.at === revision) return pending.cells;

  return stored ?? DEFAULT_GRID_CELLS;
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

function sameCells(a: GridCells, b: GridCells): boolean {
  return (
    a.spacingX === b.spacingX && a.spacingY === b.spacingY && a.subdivisions === b.subdivisions
  );
}

function sameGridSettings(a: GridSettings, b: GridSettings): boolean {
  return sameCells(a, b) && a.visible === b.visible && a.snap === b.snap;
}
