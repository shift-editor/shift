import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import type { PositionTargets } from "@/types/positionEdit";
import { MoveEdit } from "./MoveEdit";
import { RotateEdit } from "./RotateEdit";
import { ScaleEdit } from "./ScaleEdit";

/**
 * Creates fluent position edits for one authored glyph layer.
 *
 * @remarks
 * Call `move`, `rotate`, or `scale` directly for a position-only interaction.
 * The returned position edit lazily creates and owns its `GlyphLayerEdit`.
 *
 * Use {@link within} when an active `GlyphLayerEdit` already contains structural
 * changes that must commit or cancel with one position operation.
 */
export class PositionEdits {
  readonly #layer: GlyphLayer;
  readonly #edit: GlyphLayerEdit | null;

  constructor(layer: GlyphLayer, edit: GlyphLayerEdit | null = null) {
    this.#layer = layer;
    this.#edit = edit;
  }

  /**
   * Creates position operations within an existing glyph-layer edit.
   *
   * @remarks
   * Use this for a composite interaction that first adds or changes glyph
   * structure and then transforms the affected positions. The position edit
   * returned from this scoped surface takes lifecycle ownership of `edit`:
   * `commit()` finishes all structural and positional changes, while `discard()`
   * cancels all of them.
   *
   * Use the scoped surface to create one terminal position edit. For ordinary
   * position-only interactions, call `move`, `rotate`, or `scale` directly.
   *
   * @param edit - Active glyph-layer edit that already owns the interaction.
   * @returns Position operations bound to the supplied edit.
   *
   * @example
   * ```ts
   * const edit = layer.beginEdit();
   * const contourId = edit.addContour(false);
   * const pointIds = edit.addPoints(contourId, points);
   *
   * const move = layer.positions.within(edit).move({ points: pointIds });
   * move.preview(delta);
   * move.commit(); // Commits the contour, points, and movement together.
   * ```
   */
  within(edit: GlyphLayerEdit): PositionEdits {
    return new PositionEdits(this.#layer, edit);
  }

  move(targets: PositionTargets): MoveEdit {
    return new MoveEdit(this.#layer, targets, this.#edit);
  }

  rotate(targets: PositionTargets, origin: Point2D): RotateEdit {
    return new RotateEdit(this.#layer, targets, origin, this.#edit);
  }

  scale(targets: PositionTargets, origin: Point2D): ScaleEdit {
    return new ScaleEdit(this.#layer, targets, origin, this.#edit);
  }
}
