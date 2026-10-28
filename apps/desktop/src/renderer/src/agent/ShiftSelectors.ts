import type { GlyphSelector, LayerSelector, SourceSelector } from "@shift/runtime";
import type { GlyphId, LayerId, SourceId } from "@shift/types";
import type { Font } from "@shift/editor/model";

/**
 * Resolves the runtime's glyph, source and layer selectors against one font.
 *
 * @remarks
 * Every agent reader resolves selectors here, so a name means the same glyph
 * or source in every read, and an unknown one fails with the same error.
 */
export class ShiftSelectors {
  readonly #font: Font;

  constructor(font: Font) {
    this.#font = font;
  }

  /** @throws {Error} when the font has no such glyph. */
  glyphId(selector: GlyphSelector): GlyphId {
    const entry =
      selector.name !== undefined
        ? this.#font.entryForName(selector.name)
        : this.#font.entryForId(selector.glyphId);
    if (!entry) throw new Error(`Glyph ${selector.name ?? selector.glyphId} is not in this font`);
    return entry.id;
  }

  /**
   * @returns the selected source, or the default source when `selector` is omitted.
   * @throws {Error} when the font has no such source, or several sources share the name.
   */
  sourceId(selector?: SourceSelector): SourceId {
    const font = this.#font;
    if (!selector) return font.defaultSource.id;

    const source =
      selector.name !== undefined
        ? font.sourceNamed(selector.name)
        : font.source(selector.sourceId);
    if (!source)
      throw new Error(`Source ${selector.name ?? selector.sourceId} is not in this font`);
    return source.id;
  }

  /**
   * @returns the selected layer: by id as given, or the glyph's layer at its
   * source (the default source when omitted).
   * @throws {Error} when the glyph or source is unknown, or the glyph has no layer there.
   */
  layerId(selector: LayerSelector): LayerId {
    if (selector.layerId !== undefined) return selector.layerId;

    const glyphId = this.glyphId(selector.glyph);
    const sourceId = this.sourceId(selector.source);
    const layerId = this.#font.layerIdFor(glyphId, sourceId);
    if (!layerId) throw new Error(`Glyph ${glyphId} has no layer in source ${sourceId}`);
    return layerId;
  }
}
