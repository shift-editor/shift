import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import type { PositionSelectionLayer, PositionTargets } from "@/types/positionEdit";
import { PositionEditLayer } from "./PositionEditLayer";

/** Owns the per-layer edits that form one atomic position interaction. */
export class PositionEditGroup {
  readonly reference: PositionEditLayer;
  readonly additional: readonly PositionEditLayer[];

  /**
   * Captures the complete matched layer set without starting any new edits.
   *
   * @param layer - Reference layer that owns the outer transaction.
   * @param targets - Reference-layer targets.
   * @param edit - Existing reference edit, when present.
   * @param additionalLayers - Pre-matched non-reference layer targets.
   */
  constructor(
    layer: GlyphLayer,
    targets: PositionTargets,
    edit: GlyphLayerEdit | null,
    additionalLayers: readonly PositionSelectionLayer[],
  ) {
    this.reference = new PositionEditLayer({ layer, targets }, edit);
    this.additional = additionalLayers.map((selection) => new PositionEditLayer(selection));
  }

  /**
   * Finishes every started layer edit through one outer transaction.
   *
   * @param label - Shared undo label for the complete interaction.
   */
  finish(label: string): void {
    const started = [this.reference, ...this.additional].filter(({ started }) => started);
    if (started.length === 0) return;

    this.reference.layer.transaction(label, () => {
      for (const layer of started) layer.finish(label);
    });
  }

  /** Cancels every started layer edit. */
  cancel(): void {
    this.reference.cancel();
    for (const layer of this.additional) layer.cancel();
  }
}
