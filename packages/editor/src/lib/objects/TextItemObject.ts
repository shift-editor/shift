import type { GlyphId, TextItemId } from "@shift/types";
import type { LocalBounds } from "../../types/coordinates";
import type { ShiftObjectOf } from "../../types/object";
import type { TextRunNode } from "../../types/node";

/** One item of a placed text run, addressable for hover and selection. */
export class TextItemObject implements ShiftObjectOf<"textItem"> {
  readonly kind = "textItem";
  readonly id: TextItemId;
  readonly itemId: TextItemId;

  /**
   * @param node - Run node whose run holds the item.
   * @param itemId - Item identity within that run.
   * @param glyphId - Glyph the item shows, or null for line breaks and unresolved names.
   */
  constructor(
    readonly node: TextRunNode,
    itemId: TextItemId,
    readonly glyphId: GlyphId | null,
  ) {
    this.id = itemId;
    this.itemId = itemId;
  }

  /**
   * Returns null: text items take no part in selection bounds.
   *
   * @remarks
   * Selection bounds drive the transform box (resize, rotate, translate), which
   * does not apply to proof text.
   */
  bounds(): LocalBounds | null {
    return null;
  }
}
