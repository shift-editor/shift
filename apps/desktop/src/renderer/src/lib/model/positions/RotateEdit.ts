import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionList } from "./PositionList";
import type { PositionEdit, PositionEditPhase, PositionTargets } from "@/types/positionEdit";
import { AngleSnap } from "./AngleSnap";

/** Preview-backed rotation configured with rotation-specific modifiers. */
export class RotateEdit implements PositionEdit {
  readonly #layer: GlyphLayer;
  readonly #base: PositionList;
  readonly #origin: Point2D;

  #edit: GlyphLayerEdit | null;
  #phase: PositionEditPhase = "configuring";
  #angleSnap: AngleSnap | null = null;

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

  angleSnappedBy(snap: AngleSnap): this {
    this.#assertConfiguring();
    this.#angleSnap = snap;
    return this;
  }

  preview(rawAngle: number): number {
    this.#beginPreview();

    const angle = this.#angleSnap?.apply(rawAngle) ?? rawAngle;
    const positions = this.#base.rotate(angle, this.#origin).positions;
    if (positions.length > 0) {
      this.#edit ??= this.#layer.beginEdit();
      this.#edit.setPositions(positions);
    }

    return angle;
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#edit?.finish("Rotate positions");
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#edit?.cancel();
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
