import type { GlyphEntry, ShaperFont } from "@shift/types";
import type { CharacterGlyph, ParagraphRequest, ShapedRun } from "@shift/wasm/protocol";
import { registerShaper, releaseShaper, shaping } from "@shift/wasm/shaping";

const released = new FinalizationRegistry<number>(releaseShaper);

/**
 * A shaper font registered in `@shift/wasm/shaping`, which shapes with
 * shift-shape.
 *
 * @remarks
 * Loaded through `loadShaping` so this module, and the shaping module it
 * imports, load only when text first needs shaping. The module's copy is
 * released when this object is collected.
 */
export class RegisteredShaper {
  /** The shaper font's revision; a new one means new tables. */
  readonly revision: number;
  readonly #handle: number;

  /**
   * Registers a shaper font and maps characters through `glyphs`.
   *
   * @throws When the module cannot read the shaper font.
   */
  constructor(font: ShaperFont, glyphs: readonly GlyphEntry[]) {
    this.revision = font.revision;
    this.#handle = registerShaper(font.bytes);
    released.register(this, this.#handle);

    const characters: CharacterGlyph[] = [];
    for (const glyph of glyphs) {
      for (const codepoint of glyph.unicodes) characters.push({ codepoint, glyphId: glyph.id });
    }
    shaping.setShaperGlyphs({
      shaper: this.#handle,
      glyphIds: font.glyphIds,
      axes: font.axes,
      characters,
    });
  }

  /**
   * Shapes paragraphs with the font's feature code.
   *
   * @returns Each paragraph's runs in logical order, in request order; null
   * for a paragraph that cannot be shaped.
   */
  shapeParagraphs(
    paragraphs: readonly ParagraphRequest[],
  ): readonly (readonly ShapedRun[] | null)[] {
    return shaping.shapeParagraphs(this.#handle, paragraphs);
  }
}
