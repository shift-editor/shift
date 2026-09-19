import { Bounds, type Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionList } from "./PositionList";
import type {
  PositionEdit,
  PositionEditPhase,
  PositionSelectionLayer,
  PositionTargets,
} from "@/types/positionEdit";
import { AngleSnap } from "./AngleSnap";

/** Preview-backed rotation configured with rotation-specific modifiers. */
export class RotateEdit implements PositionEdit {
  readonly #layer: GlyphLayer;
  readonly #base: PositionList;
  readonly #origin: Point2D;
  readonly #additionalLayers: readonly PositionSelectionLayer[];
  readonly #additionalBases: readonly PositionList[];

  #edit: GlyphLayerEdit | null;
  #additionalEdits: Array<GlyphLayerEdit | null>;
  #phase: PositionEditPhase = "configuring";
  #angleSnap: AngleSnap | null = null;

  constructor(
    layer: GlyphLayer,
    targets: PositionTargets,
    origin: Point2D,
    edit: GlyphLayerEdit | null = null,
    additionalLayers: readonly PositionSelectionLayer[] = [],
  ) {
    this.#layer = layer;
    this.#base = PositionList.fromTargetGroups(layer, targets);
    this.#origin = { ...origin };
    this.#edit = edit;
    this.#additionalLayers = additionalLayers;
    this.#additionalBases = additionalLayers.map(({ layer, targets }) =>
      PositionList.fromTargetGroups(layer, targets),
    );
    this.#additionalEdits = additionalLayers.map(() => null);
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

    for (const [index, base] of this.#additionalBases.entries()) {
      const selection = this.#additionalLayers[index];
      if (!selection) continue;

      const targetOrigin = this.#correspondingOrigin(base);
      const targetPositions = base.rotate(angle, targetOrigin).positions;
      if (targetPositions.length === 0) continue;

      const edit = this.#additionalEdits[index] ?? selection.layer.beginEdit();
      this.#additionalEdits[index] = edit;
      edit.setPositions(targetPositions);
    }

    return angle;
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    const edits = [this.#edit, ...this.#additionalEdits].filter(
      (edit): edit is GlyphLayerEdit => edit !== null,
    );
    if (edits.length === 0) return;

    this.#layer.transaction("Rotate positions", () => {
      for (const edit of edits) edit.finish("Rotate positions");
    });
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#edit?.cancel();
    for (const edit of this.#additionalEdits) edit?.cancel();
  }

  #correspondingOrigin(base: PositionList): Point2D {
    const referenceBounds = Bounds.fromPoints(this.#base.positions);
    const targetBounds = Bounds.fromPoints(base.positions);
    if (!referenceBounds || !targetBounds) return { ...this.#origin };

    const referenceWidth = referenceBounds.max.x - referenceBounds.min.x;
    const referenceHeight = referenceBounds.max.y - referenceBounds.min.y;
    const targetWidth = targetBounds.max.x - targetBounds.min.x;
    const targetHeight = targetBounds.max.y - targetBounds.min.y;
    const xRatio =
      referenceWidth === 0 ? 0.5 : (this.#origin.x - referenceBounds.min.x) / referenceWidth;
    const yRatio =
      referenceHeight === 0 ? 0.5 : (this.#origin.y - referenceBounds.min.y) / referenceHeight;

    return {
      x: targetBounds.min.x + targetWidth * xRatio,
      y: targetBounds.min.y + targetHeight * yRatio,
    };
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
