import type { GlyphId } from "@shift/types";

/** How a click combines with the current selection. */
export interface SelectionModifiers {
  /** Extends from the anchor to the clicked glyph (Shift). */
  readonly range: boolean;
  /** Adds or removes the clicked glyph alone (⌘ or Ctrl). */
  readonly toggle: boolean;
}

/**
 * The glyphs selected in a grid of glyphs, in grid order, with the glyph a
 * range extends from (`anchor`) and the one last moved to (`focus`).
 *
 * @remarks
 * Immutable: every change returns a new selection over the same glyphs.
 * When the grid's glyphs change, {@link withGlyphs} carries the selection
 * over to them.
 */
export class GlyphSelection {
  readonly glyphs: readonly GlyphId[];
  readonly ids: readonly GlyphId[];
  readonly anchor: GlyphId | null;
  readonly focus: GlyphId | null;

  private constructor(
    glyphs: readonly GlyphId[],
    ids: readonly GlyphId[],
    anchor: GlyphId | null,
    focus: GlyphId | null,
  ) {
    this.glyphs = glyphs;
    this.ids = ids;
    this.anchor = anchor;
    this.focus = focus;
  }

  /** Nothing selected among `glyphs`. */
  static empty(glyphs: readonly GlyphId[]): GlyphSelection {
    return new GlyphSelection(glyphs, [], null, null);
  }

  get isEmpty(): boolean {
    return this.ids.length === 0;
  }

  has(glyph: GlyphId): boolean {
    return this.ids.includes(glyph);
  }

  /** Nothing selected among the same glyphs. */
  clear(): GlyphSelection {
    return this.isEmpty ? this : GlyphSelection.empty(this.glyphs);
  }

  /**
   * The selection after clicking `glyph`, or empty space when it is null:
   * a plain click selects only it, Shift selects the range from the anchor,
   * and ⌘ or Ctrl adds or removes it.
   */
  click(glyph: GlyphId | null, modifiers: SelectionModifiers): GlyphSelection {
    if (glyph === null) {
      return modifiers.range || modifiers.toggle ? this : this.clear();
    }
    if (modifiers.range && this.#inGrid(this.anchor)) {
      return this.#with(this.#range(this.anchor, glyph), this.anchor, glyph);
    }
    if (modifiers.toggle) {
      const ids = this.has(glyph)
        ? this.ids.filter((id) => id !== glyph)
        : this.#inGridOrder([...this.ids, glyph]);
      return this.#with(ids, glyph, glyph);
    }
    return this.#with([glyph], glyph, glyph);
  }

  /** The selection while dragging from `anchor` to `glyph`: the glyphs between them. */
  drag(anchor: GlyphId, glyph: GlyphId): GlyphSelection {
    return this.#with(this.#range(anchor, glyph), anchor, glyph);
  }

  /**
   * The selection after an arrow key: the focus moves one glyph, stopping at
   * either end, selecting only it, or with `extend` (Shift) the range from the
   * anchor to it. With nothing focused, it starts at the first glyph.
   */
  step(offset: -1 | 1, extend: boolean): GlyphSelection {
    const first = this.glyphs[0];
    if (first === undefined) return this.clear();
    const focusIndex = this.focus === null ? -1 : this.glyphs.indexOf(this.focus);
    if (focusIndex === -1) return this.#with([first], first, first);

    const nextIndex = Math.min(Math.max(focusIndex + offset, 0), this.glyphs.length - 1);
    const next = this.glyphs[nextIndex] ?? first;
    if (extend && this.#inGrid(this.anchor)) {
      return this.#with(this.#range(this.anchor, next), this.anchor, next);
    }
    return this.#with([next], next, next);
  }

  /** Every glyph, anchored at the first. */
  all(): GlyphSelection {
    return this.#with([...this.glyphs], this.glyphs[0] ?? null, this.glyphs.at(-1) ?? null);
  }

  /** The selection carried over to the grid's new `glyphs`, without ones no longer in it. */
  withGlyphs(glyphs: readonly GlyphId[]): GlyphSelection {
    if (glyphs === this.glyphs) return this;
    const kept = (id: GlyphId | null) => (id !== null && glyphs.includes(id) ? id : null);
    return new GlyphSelection(
      glyphs,
      this.ids.filter((id) => glyphs.includes(id)),
      kept(this.anchor),
      kept(this.focus),
    );
  }

  #with(ids: readonly GlyphId[], anchor: GlyphId | null, focus: GlyphId | null): GlyphSelection {
    return new GlyphSelection(this.glyphs, ids, anchor, focus);
  }

  #inGrid(id: GlyphId | null): id is GlyphId {
    return id !== null && this.glyphs.includes(id);
  }

  #range(from: GlyphId, to: GlyphId): GlyphId[] {
    const a = this.glyphs.indexOf(from);
    const b = this.glyphs.indexOf(to);
    return this.glyphs.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  #inGridOrder(ids: readonly GlyphId[]): GlyphId[] {
    return this.glyphs.filter((glyph) => ids.includes(glyph));
  }
}
