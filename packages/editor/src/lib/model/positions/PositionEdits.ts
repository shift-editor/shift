import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import type {
  PositionSelection,
  PositionSelectionLayer,
  PositionTargets,
} from "../../../types/positionEdit";
import { MoveEdit } from "./MoveEdit";
import { RotateEdit } from "./RotateEdit";
import { ScaleEdit } from "./ScaleEdit";

/**
 * Creates fluent position edits for authored glyph layers.
 *
 * @remarks
 * Call `move`, `rotate`, or `scale` directly for a position-only interaction.
 * The returned position edit lazily creates and owns one `GlyphLayerEdit` per
 * selected layer and commits them through one outer workspace transaction.
 *
 * Use {@link within} when an active `GlyphLayerEdit` already contains structural
 * changes that must commit or cancel with one single-layer position operation.
 */
export class PositionEdits {
  readonly #layer: GlyphLayer;
  readonly #edit: GlyphLayerEdit | null;
  readonly #additionalLayers: readonly PositionSelectionLayer[];

  /**
   * Creates position operations rooted in one reference layer.
   *
   * @param layer - Authored layer that drives feedback and snapping.
   * @param edit - Existing single-layer edit to own, when present.
   * @param additionalLayers - Pre-matched target layers for atomic fan-out.
   */
  constructor(
    layer: GlyphLayer,
    edit: GlyphLayerEdit | null = null,
    additionalLayers: readonly PositionSelectionLayer[] = [],
  ) {
    this.#layer = layer;
    this.#edit = edit;
    this.#additionalLayers = additionalLayers;
  }

  /**
   * Creates transforms over one reference selection and its matched layers.
   *
   * The supplied identities are frozen for the returned interaction; preview
   * frames never resolve layer matches or perform workspace reads.
   *
   * @param selection - Reference targets and complete matched-layer targets.
   * @returns Position operations over the supplied layer set.
   */
  static fromSelection(selection: PositionSelection): PositionEdits {
    return new PositionEdits(selection.layer, null, selection.additionalLayers);
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
    return new MoveEdit(this.#layer, targets, this.#edit, this.#additionalLayers);
  }

  rotate(targets: PositionTargets, origin: Point2D): RotateEdit {
    return new RotateEdit(this.#layer, targets, origin, this.#edit, this.#additionalLayers);
  }

  scale(targets: PositionTargets, origin: Point2D): ScaleEdit {
    return new ScaleEdit(this.#layer, targets, origin, this.#edit, this.#additionalLayers);
  }
}
