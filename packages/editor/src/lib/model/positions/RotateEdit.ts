import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionEditGroup } from "./PositionEditGroup";
import type {
  PositionEdit,
  PositionEditPhase,
  PositionSelectionLayer,
  PositionTargets,
} from "../../../types/positionEdit";
import { AngleSnap } from "./AngleSnap";

/** Preview-backed rotation configured with rotation-specific modifiers. */
export class RotateEdit implements PositionEdit {
  readonly #layers: PositionEditGroup;
  readonly #origin: Point2D;
  #phase: PositionEditPhase = "configuring";
  #angleSnap: AngleSnap | null = null;

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

  angleSnappedBy(snap: AngleSnap): this {
    this.#assertConfiguring();
    this.#angleSnap = snap;
    return this;
  }

  preview(rawAngle: number): number {
    this.#beginPreview();

    const angle = this.#angleSnap?.apply(rawAngle) ?? rawAngle;
    const reference = this.#layers.reference;
    reference.setPositions(reference.base.rotate(angle, this.#origin).positions);

    for (const layer of this.#layers.additional) {
      const targetOrigin = reference.base.correspondingPoint(this.#origin, layer.base);
      layer.setPositions(layer.base.rotate(angle, targetOrigin).positions);
    }

    return angle;
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#layers.finish("Rotate positions");
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#layers.cancel();
  }

  #assertConfiguring(): void {
    if (this.#phase === "configuring") return;
    throw new Error("Position edit modifiers must be configured before the first preview");
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
