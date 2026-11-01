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
  /** The selected glyphs, in grid order. */
  readonly ids: readonly GlyphId[];
  readonly anchor: GlyphId | null;
  readonly focus: GlyphId | null;
  readonly #glyphSet: ReadonlySet<GlyphId>;
  readonly #selected: ReadonlySet<GlyphId>;

  private constructor(
    glyphs: readonly GlyphId[],
    glyphSet: ReadonlySet<GlyphId>,
    selected: ReadonlySet<GlyphId>,
    anchor: GlyphId | null,
    focus: GlyphId | null,
  ) {
    this.glyphs = glyphs;
    this.#glyphSet = glyphSet;
    this.#selected = selected;
    this.ids = glyphs.filter((glyph) => selected.has(glyph));
    this.anchor = anchor;
    this.focus = focus;
  }

  /** Nothing selected among `glyphs`. */
  static empty(glyphs: readonly GlyphId[]): GlyphSelection {
    return new GlyphSelection(glyphs, new Set(glyphs), new Set(), null, null);
  }

  get isEmpty(): boolean {
    return this.#selected.size === 0;
  }

  has(glyph: GlyphId): boolean {
    return this.#selected.has(glyph);
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
      return this.#with(this.#selected.symmetricDifference(new Set([glyph])), glyph, glyph);
    }
    return this.#with(new Set([glyph]), glyph, glyph);
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
    if (focusIndex === -1) return this.#with(new Set([first]), first, first);

    const nextIndex = Math.min(Math.max(focusIndex + offset, 0), this.glyphs.length - 1);
    const next = this.glyphs[nextIndex] ?? first;
    if (extend && this.#inGrid(this.anchor)) {
      return this.#with(this.#range(this.anchor, next), this.anchor, next);
    }
    return this.#with(new Set([next]), next, next);
  }

  /** Every glyph, anchored at the first. */
  all(): GlyphSelection {
    return this.#with(this.#glyphSet, this.glyphs[0] ?? null, this.glyphs.at(-1) ?? null);
  }

  /** The selection carried over to `glyphs`, without glyphs that are no longer glyphs. */
  withGlyphs(glyphs: readonly GlyphId[]): GlyphSelection {
    if (glyphs === this.glyphs) return this;
    const glyphSet = new Set(glyphs);
    const kept = (id: GlyphId | null) => (id !== null && glyphSet.has(id) ? id : null);
    return new GlyphSelection(
      glyphs,
      glyphSet,
      this.#selected.intersection(glyphSet),
      kept(this.anchor),
      kept(this.focus),
    );
  }

  #with(
    selected: ReadonlySet<GlyphId>,
    anchor: GlyphId | null,
    focus: GlyphId | null,
  ): GlyphSelection {
    return new GlyphSelection(this.glyphs, this.#glyphSet, selected, anchor, focus);
  }

  #inGrid(id: GlyphId | null): id is GlyphId {
    return id !== null && this.#glyphSet.has(id);
  }

  #range(from: GlyphId, to: GlyphId): ReadonlySet<GlyphId> {
    const a = this.glyphs.indexOf(from);
    const b = this.glyphs.indexOf(to);
    return new Set(this.glyphs.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
}
