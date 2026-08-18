import type { Point2D } from "@shift/geo";
import type { PositionEdit, PositionEditPhase, PositionTargets } from "@/types/positionEdit";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionList } from "./PositionList";

/** Preview-backed scaling around one frozen layer-local origin. */
export class ScaleEdit implements PositionEdit {
  readonly #layer: GlyphLayer;
  readonly #base: PositionList;
  readonly #origin: Point2D;

  #edit: GlyphLayerEdit | null;
  #phase: PositionEditPhase = "configuring";

  constructor(
    layer: GlyphLayer,
    targets: PositionTargets,
    origin: Point2D,
    edit: GlyphLayerEdit | null = null,
  ) {
    this.#layer = layer;
    this.#base = PositionList.fromTargetGroups(layer, targets);
    this.#origin = { ...origin };
    this.#edit = edit;
  }

  preview(scale: Point2D): void {
    this.#beginPreview();

    const positions = this.#base.scale(scale.x, scale.y, this.#origin).positions;
    if (positions.length === 0) return;

    this.#edit ??= this.#layer.beginEdit();
    this.#edit.setPositions(positions);
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#edit?.finish("Scale positions");
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#edit?.cancel();
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
