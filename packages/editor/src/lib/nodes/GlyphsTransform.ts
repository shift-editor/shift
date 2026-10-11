import type { Point2D, Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import type { Editor } from "../editor/Editor";
import type { GlyphLayer } from "../model/Glyph";
import type { GlyphTransformEdit } from "../model/GlyphTransformEdit";
import { batch } from "../signals";
import type { TransformAction, TransformEdit, TransformTarget } from "../../types/transformTarget";

const LABELS: Record<TransformAction, string> = {
  move: "Move glyphs",
  scale: "Scale glyphs",
  rotate: "Rotate glyphs",
};

/** One whole glyph to transform, placed in the selection node's units. */
export interface GlyphsTransformPart {
  readonly glyphId: GlyphId;
  readonly layer: GlyphLayer;
  /** Where the glyph's origin sits. */
  readonly origin: Point2D;
  /** The glyph's outline box; the part pivots on it. */
  readonly bounds: Rect2D;
}

/**
 * Transforms several whole glyph layers as one undo step, each glyph pivoting on its own bounds.
 *
 * @remarks
 * Scaling keeps each glyph's right sidebearing; moving and rotating keep the
 * advance. Components built on another glyph in the set follow it instead of
 * transforming again (see `GlyphTransformEdit`).
 */
export class GlyphsTransform implements TransformTarget {
  readonly #editor: Editor;
  readonly #parts: readonly GlyphsTransformPart[];
  readonly #glyphIds: ReadonlySet<GlyphId>;

  /**
   * @param bounds - Box enclosing every part, in the selection node's units.
   * @param parts - Distinct glyphs; a glyph listed twice would transform twice.
   */
  constructor(
    editor: Editor,
    readonly bounds: Rect2D,
    parts: readonly GlyphsTransformPart[],
  ) {
    this.#editor = editor;
    this.#parts = parts;
    this.#glyphIds = new Set(parts.map((part) => part.glyphId));
  }

  begin(action: TransformAction): TransformEdit {
    const edits: { edit: GlyphTransformEdit; bounds: Rect2D }[] = [];
    try {
      for (const { layer, origin, bounds } of this.#parts) {
        const edit = layer.beginTransformEdit({
          origin,
          keepRightSidebearing: action === "scale",
          transformedGlyphIds: this.#glyphIds,
        });
        edits.push({ edit, bounds });
      }
    } catch (error) {
      for (const { edit } of edits) edit.discard();
      throw error;
    }

    return {
      preview: (deltaFor) =>
        batch(() => {
          for (const { edit, bounds } of edits) edit.preview(deltaFor({ bounds }));
        }),
      commit: () =>
        this.#editor.transaction(LABELS[action], () => {
          for (const { edit } of edits) edit.commit();
        }),
      discard: () => {
        for (const { edit } of edits) edit.discard();
      },
    };
  }
}
