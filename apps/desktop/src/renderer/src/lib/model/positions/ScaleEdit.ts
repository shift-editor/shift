import { Bounds, type Point2D } from "@shift/geo";
import type {
  PositionEdit,
  PositionEditPhase,
  PositionSelectionLayer,
  PositionTargets,
} from "@/types/positionEdit";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionList } from "./PositionList";

/** Applies preview-backed scaling to one frozen position base. */
export class ScaleEdit implements PositionEdit {
  readonly #layer: GlyphLayer;
  readonly #base: PositionList;
  readonly #origin: Point2D;
  readonly #additionalLayers: readonly PositionSelectionLayer[];
  readonly #additionalBases: readonly PositionList[];

  #edit: GlyphLayerEdit | null;
  #additionalEdits: Array<GlyphLayerEdit | null>;
  #phase: PositionEditPhase = "configuring";

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

    const positions = this.#base.scale(scale.x, scale.y, origin).positions;
    if (positions.length > 0) {
      this.#edit ??= this.#layer.beginEdit();
      this.#edit.setPositions(positions);
    }

    for (const [index, base] of this.#additionalBases.entries()) {
      const selection = this.#additionalLayers[index];
      if (!selection) continue;

      const targetOrigin = this.#correspondingOrigin(base, origin);
      const targetPositions = base.scale(scale.x, scale.y, targetOrigin).positions;
      if (targetPositions.length === 0) continue;

      const edit = this.#additionalEdits[index] ?? selection.layer.beginEdit();
      this.#additionalEdits[index] = edit;
      edit.setPositions(targetPositions);
    }
  }

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    const edits = [this.#edit, ...this.#additionalEdits].filter(
      (edit): edit is GlyphLayerEdit => edit !== null,
    );
    if (edits.length === 0) return;

    this.#layer.transaction("Scale positions", () => {
      for (const edit of edits) edit.finish("Scale positions");
    });
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#edit?.cancel();
    for (const edit of this.#additionalEdits) edit?.cancel();
  }

  #correspondingOrigin(base: PositionList, origin: Point2D): Point2D {
    const referenceBounds = Bounds.fromPoints(this.#base.positions);
    const targetBounds = Bounds.fromPoints(base.positions);
    if (!referenceBounds || !targetBounds) return { ...origin };

    const referenceWidth = referenceBounds.max.x - referenceBounds.min.x;
    const referenceHeight = referenceBounds.max.y - referenceBounds.min.y;
    const targetWidth = targetBounds.max.x - targetBounds.min.x;
    const targetHeight = targetBounds.max.y - targetBounds.min.y;
    const xRatio = referenceWidth === 0 ? 0.5 : (origin.x - referenceBounds.min.x) / referenceWidth;
    const yRatio =
      referenceHeight === 0 ? 0.5 : (origin.y - referenceBounds.min.y) / referenceHeight;

    return {
      x: targetBounds.min.x + targetWidth * xRatio,
      y: targetBounds.min.y + targetHeight * yRatio,
    };
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
