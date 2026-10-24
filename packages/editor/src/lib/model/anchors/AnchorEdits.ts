import type { Point2D } from "@shift/geo";
import type { AnchorId, SourceId } from "@shift/types";
import type { GlyphLayer } from "../Glyph";
import type { PositionSelection, PositionSelectionLayer } from "../../../types/positionEdit";

/**
 * Anchor edits across a reference layer and its matched layers.
 *
 * @remarks
 * Like {@link PositionEdits}, an edit is built from a frozen selection: the
 * active source's anchors and their matches in every other source being
 * edited. Each operation writes every layer; callers wrap it in one
 * transaction so it is one undo step.
 */
export class AnchorEdits {
  readonly #layers: readonly PositionSelectionLayer[];

  private constructor(layers: readonly PositionSelectionLayer[]) {
    this.#layers = layers;
  }

  /** Edits the selected anchors and their matches in every other source being edited. */
  static fromSelection(selection: PositionSelection): AnchorEdits {
    return new AnchorEdits([selection, ...selection.additionalLayers]);
  }

  /**
   * Adds an anchor at the same position to each layer.
   *
   * @remarks
   * Named `new`, or `new.1`, `new.2`, … when taken in any layer, as Glyphs names it.
   *
   * @returns The new anchor's id in each layer's source.
   */
  static add(layers: readonly GlyphLayer[], position: Point2D): ReadonlyMap<SourceId, AnchorId> {
    const taken = new Set(layers.flatMap((layer) => layer.anchors.map((anchor) => anchor.name)));
    let name = "new";
    for (let suffix = 1; taken.has(name); suffix++) name = `new.${suffix}`;
    const at = { x: Math.round(position.x), y: Math.round(position.y) };
    return new Map(layers.map((layer) => [layer.sourceId, layer.addAnchor(name, at)] as const));
  }

  rename(name: string): void {
    for (const { layer, targets } of this.#layers) {
      layer.renameAnchors(new Map(targets.anchors.map((id) => [id, name] as const)));
    }
  }

  remove(): void {
    for (const { layer, targets } of this.#layers) layer.removeAnchors(targets.anchors);
  }

  /**
   * Moves the reference anchors to one coordinate on an axis.
   *
   * @remarks
   * Each matched anchor moves by the amount its reference anchor does, as a
   * move does, so sources keep their own positions relative to each other.
   */
  setAxis(axis: "x" | "y", value: number): void {
    const [reference] = this.#layers;
    if (!reference) return;
    const deltas = reference.targets.anchors.map((id) => {
      const anchor = reference.layer.anchor(id);
      return anchor ? value - anchor[axis] : 0;
    });
    for (const { layer, targets } of this.#layers) {
      layer.applyPositionPatch(
        targets.anchors.flatMap((id, index) => {
          const anchor = layer.anchor(id);
          const delta = deltas[index] ?? 0;
          if (!anchor || delta === 0) return [];
          const x = axis === "x" ? anchor.x + delta : anchor.x;
          const y = axis === "y" ? anchor.y + delta : anchor.y;
          return [{ kind: "anchor" as const, id, x, y }];
        }),
      );
    }
  }
}
