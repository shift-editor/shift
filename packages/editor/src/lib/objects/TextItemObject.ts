import type { GlyphId, TextItemId } from "@shift/types";
import type { LocalBounds } from "../../types/coordinates";
import type { ShiftObjectOf } from "../../types/object";
import type { TextRunNode } from "../../types/node";
import type { TextRunNodeDefinition } from "../nodes/TextRunNodeDefinition";

/** One item of a placed text run, addressable for hover and selection. */
export class TextItemObject implements ShiftObjectOf<"textItem"> {
  readonly kind = "textItem";
  readonly id: TextItemId;
  readonly itemId: TextItemId;

  /**
   * @param node - Run node whose run holds the item.
   * @param itemId - Item identity within that run.
   * @param glyphId - Glyph the item shows, or null for line breaks and unresolved names.
   * @param definition - The run's definition, which owns item geometry.
   */
  constructor(
    readonly node: TextRunNode,
    itemId: TextItemId,
    readonly glyphId: GlyphId | null,
    readonly definition: TextRunNodeDefinition,
  ) {
    this.id = itemId;
    this.itemId = itemId;
  }

  /** Returns the glyph's outline box in the run's units, which places the transform box. */
  bounds(): LocalBounds | null {
    return this.definition.itemBounds(this.node, this.itemId);
  }
}
