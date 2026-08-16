import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import { PositionEditDraft } from "./PositionEditDraft";
import type { PositionEdit, PositionEditPhase, PositionTargets } from "@/types/positionEdit";
import { AngleSnap } from "./AngleSnap";

/** Preview-backed rotation configured with rotation-specific modifiers. */
export class RotateEdit implements PositionEdit {
  readonly #draft: PositionEditDraft;
  readonly #origin: Point2D;

  #phase: PositionEditPhase = "configuring";
  #angleSnap: AngleSnap | null = null;

  constructor(layer: GlyphLayer, targets: PositionTargets, origin: Point2D) {
    this.#draft = new PositionEditDraft(layer, targets);
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
    this.#draft.previewRotate(angle, this.#origin);
    return angle;
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#draft.commit();
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#draft.discard();
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
