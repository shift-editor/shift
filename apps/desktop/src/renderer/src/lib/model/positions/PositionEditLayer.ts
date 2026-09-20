import type { GlyphLayer, GlyphLayerPositions } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import type { PositionSelectionLayer, PositionTargets } from "@/types/positionEdit";
import { PositionList } from "./PositionList";

/** Owns the frozen positions and lazy layer edit for one transform participant. */
export class PositionEditLayer {
  readonly layer: GlyphLayer;
  readonly targets: PositionTargets;

  #base: PositionList;
  #edit: GlyphLayerEdit | null;

  /**
   * Captures one layer's transform base without starting an edit.
   *
   * @param selection - Layer and matched targets participating in the interaction.
   * @param edit - Existing edit to own, when the interaction includes structural work.
   */
  constructor(selection: PositionSelectionLayer, edit: GlyphLayerEdit | null = null) {
    this.layer = selection.layer;
    this.targets = selection.targets;
    this.#base = PositionList.fromTargetGroups(selection.layer, selection.targets);
    this.#edit = edit;
  }

  get base(): PositionList {
    return this.#base;
  }

  get started(): boolean {
    return this.#edit !== null;
  }

  include(positions: GlyphLayerPositions): void {
    this.#base = this.#base.includeFrom(this.layer, positions);
  }

  setPositions(positions: GlyphLayerPositions): void {
    if (positions.length === 0) return;

    this.#edit ??= this.layer.beginEdit();
    this.#edit.setPositions(positions);
  }

  finish(label: string): void {
    this.#edit?.finish(label);
  }

  cancel(): void {
    this.#edit?.cancel();
  }
}
