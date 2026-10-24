import type { KerningPairPosition } from "@shift/editor/model";
import type { GlyphId } from "@shift/types";

/**
 * What the kerning groups panel opens on: a selected pair, whose groups are
 * set against each other in the preview, or one glyph, both of whose edges
 * are shown with nothing to kern them against.
 */
export class KerningGroupsTarget {
  /** A selected pair, `first` before `second`. */
  static pair(first: GlyphId, second: GlyphId): KerningGroupsTarget {
    return new KerningGroupsTarget(first, second);
  }

  /** One glyph, at both pair positions. */
  static glyph(glyphId: GlyphId): KerningGroupsTarget {
    return new KerningGroupsTarget(glyphId, null);
  }

  readonly #first: GlyphId;
  readonly #second: GlyphId | null;

  private constructor(first: GlyphId, second: GlyphId | null) {
    this.#first = first;
    this.#second = second;
  }

  /** Equal for the same pair or the same glyph, so a view keyed on it resets when it changes. */
  get key(): string {
    return this.#second === null ? `glyph:${this.#first}` : `${this.#first}:${this.#second}`;
  }

  /** The glyph at a pair position, whose group a tab opens on. */
  glyphAt(position: KerningPairPosition): GlyphId {
    if (this.#second === null) return this.#first;

    return position === "first" ? this.#first : this.#second;
  }

  /** The glyph a tab's preview sets the members against: the pair's other glyph, if any. */
  partnerAt(position: KerningPairPosition): GlyphId | null {
    if (this.#second === null) return null;

    return position === "first" ? this.#second : this.#first;
  }
}
