import type { Point2D } from "@shift/geo";
import type {
  PositionEdit,
  PositionEditPhase,
  PositionSelectionLayer,
  PositionTargets,
} from "../../../types/positionEdit";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionEditGroup } from "./PositionEditGroup";

/** Applies preview-backed scaling to one frozen position base. */
export class ScaleEdit implements PositionEdit {
  readonly #layers: PositionEditGroup;
  readonly #origin: Point2D;
  #phase: PositionEditPhase = "configuring";

  constructor(
    layer: GlyphLayer,
    targets: PositionTargets,
    origin: Point2D,
    edit: GlyphLayerEdit | null = null,
    additionalLayers: readonly PositionSelectionLayer[] = [],
  ) {
    this.#layers = new PositionEditGroup(layer, targets, edit, additionalLayers);
    this.#origin = { ...origin };
  }

  /**
   * Previews scaling from the original positions around a layer-local pivot.
   *
   * @remarks
   * Changing the pivot does not replace the original position base or start a new
   * edit. An explicit pivot applies only to this preview, not subsequent defaults.
   *
   * @param scale - Signed scale factors on each glyph-local axis.
   * @param origin - Pivot for this preview; defaults to the origin captured at construction.
   * @throws {Error} When the edit has already been committed or discarded.
   */
  preview(scale: Point2D, origin: Point2D = this.#origin): void {
    this.#beginPreview();

    const reference = this.#layers.reference;
    reference.setPositions(reference.base.scale(scale.x, scale.y, origin).positions);

    for (const layer of this.#layers.additional) {
      const targetOrigin = reference.base.correspondingPoint(origin, layer.base);
      layer.setPositions(layer.base.scale(scale.x, scale.y, targetOrigin).positions);
    }
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#layers.finish("Scale positions");
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#layers.cancel();
  }

  #beginPreview(): void {
    switch (this.#phase) {
      case "configuring":
        this.#phase = "previewing";
        return;
      case "previewing":
        return;
      case "committed":
      case "discarded":
        throw new Error("Cannot preview a completed position edit");
    }
  }
}
