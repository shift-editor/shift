import type { MarkColor } from "@shift/types";
import { signal, type Signal, type WritableSignal } from "@shift/editor/signals";
import { markColorKey, type MarkColorKey } from "./markColor";

/** The widths a glyph tile can be given, in CSS pixels; rows fill, so tiles may be a little wider. */
export const TILE_SIZE = { min: 56, default: 100, max: 220 } as const;

/** The colours the grid is filtered to, by key; null stands for glyphs with no colour. */
export type MarkColorFilter = ReadonlyMap<MarkColorKey, MarkColor | null>;

/**
 * How a window looks at the font overview's grid: how big its tiles are and
 * which tag colours it is filtered to.
 *
 * @remarks
 * The window's alone and kept while other tabs are shown; never saved in the
 * document or undone.
 */
export class GlyphGridView {
  readonly #tileSizeCell: WritableSignal<number>;
  readonly #colorFilterCell = signal<MarkColorFilter>(new Map(), {
    name: "desktop.grid.colorFilter",
  });

  /** @param tileSize - the width tiles start at. */
  constructor(tileSize: number = TILE_SIZE.default) {
    this.#tileSizeCell = signal(tileSize, { name: "desktop.grid.tileSize" });
  }

  /** The width tiles are given, within {@link TILE_SIZE}. */
  get tileSizeCell(): Signal<number> {
    return this.#tileSizeCell;
  }

  /** The colours the grid shows; empty shows every glyph. */
  get colorFilterCell(): Signal<MarkColorFilter> {
    return this.#colorFilterCell;
  }

  setTileSize(size: number): void {
    this.#tileSizeCell.set(Math.min(Math.max(Math.round(size), TILE_SIZE.min), TILE_SIZE.max));
  }

  /**
   * Filters the grid by a colour, as clicking its swatch does: alone it shows
   * only that colour, or every glyph again when it was the only one shown;
   * with `add` (⌘ or Ctrl) it is added to or taken out of the colours shown.
   *
   * @param color - null for glyphs with no colour.
   */
  filterColor(color: MarkColor | null, add: boolean): void {
    const current = this.#colorFilterCell.peek();
    const key = markColorKey(color);
    const shown = current.has(key);
    if (!add) {
      const only = shown && current.size === 1;
      this.#colorFilterCell.set(only ? new Map() : new Map([[key, color]]));
      return;
    }

    const next = new Map(current);
    if (shown) next.delete(key);
    else next.set(key, color);
    this.#colorFilterCell.set(next);
  }
}
