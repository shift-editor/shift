import type { GlyphId, LayerId, LayerMatch, PointId, AnchorId, SourceId } from "@shift/types";
import type { Font } from "@shift/editor/lib/model/Font";
import type { Glyph, GlyphLayer } from "@shift/editor/lib/model/Glyph";
import { effect, signal, track, type Effect, type Signal } from "@shift/editor/lib/signals/index";
import type {
  PositionSelection,
  PositionSelectionLayer,
  PositionTargets,
} from "../../types/positionEdit";
import { LatestRequest } from "@shift/editor/lib/utils/LatestRequest";
import type { Scene } from "./Scene";

/** Resolves and retains topology matches for the editor's selected source layers. */
export class MultiSourceEditing {
  readonly #font: Font;
  readonly #scene: Scene;
  readonly #glyphForId: (glyphId: GlyphId) => Glyph | null;
  readonly #activeSourceIdCell: Signal<SourceId | null>;
  readonly #editingSourceIdsCell: Signal<ReadonlySet<SourceId>>;
  readonly #matchesCell = signal<ReadonlyMap<LayerId, LayerMatch>>(new Map(), {
    name: "editor.layers.matches",
  });
  readonly #latest = new LatestRequest();
  readonly #effect: Effect;

  #inputs: readonly unknown[] = [];

  /**
   * Starts reactive matching for the editor's placed glyphs and source selection.
   *
   * @param font - Font boundary that derives Rust-owned layer matches.
   * @param scene - Placed glyph nodes whose authored layers may participate.
   * @param glyphForId - Synchronous lookup for completely loaded glyphs.
   * @param activeSourceIdCell - Reference source selected for direct editing.
   * @param editingSourceIdsCell - Complete source set transformed together.
   */
  constructor(
    font: Font,
    scene: Scene,
    glyphForId: (glyphId: GlyphId) => Glyph | null,
    activeSourceIdCell: Signal<SourceId | null>,
    editingSourceIdsCell: Signal<ReadonlySet<SourceId>>,
  ) {
    this.#font = font;
    this.#scene = scene;
    this.#glyphForId = glyphForId;
    this.#activeSourceIdCell = activeSourceIdCell;
    this.#editingSourceIdsCell = editingSourceIdsCell;
    this.#effect = effect(() => this.#prepareMatches(), {
      name: "editor.layers.matching",
    });
  }

  /** Returns the live matches keyed by non-reference layer ID. */
  get matchesCell(): Signal<ReadonlyMap<LayerId, LayerMatch>> {
    return this.#matchesCell;
  }

  /**
   * Maps one reference-layer selection onto every selected source layer.
   *
   * @param reference - Normalized targets owned by the active source layer.
   * @returns The complete multi-layer selection, or `null` while any mapping is unavailable.
   */
  resolve(reference: PositionSelectionLayer): PositionSelection | null {
    const editingSourceIds = this.#editingSourceIdsCell.peek();
    if (editingSourceIds.size <= 1) return { ...reference, additionalLayers: [] };

    const glyph = this.#glyphForLayer(reference.layer);
    if (!glyph) return null;

    const activeSourceId = this.#activeSourceIdCell.peek();
    if (!activeSourceId) return null;

    const matches = this.#matchesCell.peek();
    const additionalLayers: PositionSelectionLayer[] = [];
    for (const source of this.#font.sources) {
      if (source.id === activeSourceId || !editingSourceIds.has(source.id)) continue;

      const targetLayer = glyph.layerForSource(source.id);
      if (!targetLayer) return null;

      const layerMatch = matches.get(targetLayer.id);
      if (!layerMatch?.complete || layerMatch.referenceLayerId !== reference.layer.id) return null;

      const targets = mapTargets(reference, layerMatch);
      if (!targets) return null;

      additionalLayers.push({ layer: targetLayer, targets });
    }

    return { ...reference, additionalLayers };
  }

  /** Stops matching and prevents pending requests from publishing. */
  dispose(): void {
    this.#latest.invalidate();
    this.#effect.dispose();
  }

  #prepareMatches(): void {
    track(this.#activeSourceIdCell);
    track(this.#editingSourceIdsCell);
    track(this.#scene.cell);
    const activeSourceId = this.#activeSourceIdCell.peek();
    const editingSourceIds = this.#editingSourceIdsCell.peek();

    const inputs: unknown[] = [activeSourceId, ...editingSourceIds];
    const layerPairs = new Map<LayerId, LayerId>();
    let completeReadSet = activeSourceId !== null;
    if (activeSourceId && editingSourceIds.size > 1) {
      for (const node of this.#scene.nodesOfKind("glyph")) {
        inputs.push(node.glyphId);
        const glyph = this.#glyphForId(node.glyphId);
        const referenceLayer = glyph?.layerForSource(activeSourceId);
        inputs.push(referenceLayer?.id ?? null);
        if (!glyph || !referenceLayer) {
          completeReadSet = false;
          break;
        }
        track(referenceLayer.structureCell);
        inputs.push(referenceLayer.structureCell.peek());

        for (const sourceId of editingSourceIds) {
          if (sourceId === activeSourceId) continue;

          const targetLayer = glyph.layerForSource(sourceId);
          inputs.push(sourceId, targetLayer?.id ?? null);
          if (!targetLayer) {
            completeReadSet = false;
            break;
          }
          track(targetLayer.structureCell);
          inputs.push(targetLayer.structureCell.peek());
          layerPairs.set(targetLayer.id, referenceLayer.id);
        }
        if (!completeReadSet) break;
      }
    }

    const inputsChanged =
      inputs.length !== this.#inputs.length ||
      inputs.some((input, index) => !Object.is(input, this.#inputs[index]));
    if (!inputsChanged) return;

    this.#inputs = inputs;
    this.#matchesCell.set(new Map());
    if (!completeReadSet || layerPairs.size === 0) {
      this.#latest.invalidate();
      return;
    }

    void this.#resolveMatches(layerPairs);
  }

  async #resolveMatches(layerPairs: ReadonlyMap<LayerId, LayerId>): Promise<void> {
    const result = await this.#latest.run(async () => {
      try {
        return await Promise.all(
          Array.from(layerPairs, ([targetLayerId, referenceLayerId]) =>
            this.#font.matchLayers(referenceLayerId, targetLayerId),
          ),
        );
      } catch {
        return null;
      }
    });
    if (result.status === "stale") return;

    const matches = result.result ?? [];
    this.#matchesCell.set(
      new Map(matches.map((layerMatch) => [layerMatch.targetLayerId, layerMatch])),
    );
  }

  #glyphForLayer(layer: GlyphLayer): Glyph | null {
    for (const node of this.#scene.nodesOfKind("glyph")) {
      if (node.sourceId !== layer.sourceId) continue;

      const glyph = this.#glyphForId(node.glyphId);
      if (glyph?.layerForSource(node.sourceId)?.id === layer.id) return glyph;
    }

    return null;
  }
}

function mapTargets(reference: PositionSelectionLayer, match: LayerMatch): PositionTargets | null {
  const pointMatches = new Map(
    match.points.map((pointMatch) => [pointMatch.referenceId, pointMatch.targetId]),
  );
  const anchorMatches = new Map(
    match.anchors.map((anchorMatch) => [anchorMatch.referenceId, anchorMatch.targetId]),
  );
  const points: PointId[] = [];
  for (const pointId of reference.targets.points ?? []) {
    const targetPointId = pointMatches.get(pointId);
    if (!targetPointId) return null;
    points.push(targetPointId);
  }
  const anchors: AnchorId[] = [];
  for (const anchorId of reference.targets.anchors ?? []) {
    const targetAnchorId = anchorMatches.get(anchorId);
    if (!targetAnchorId) return null;
    anchors.push(targetAnchorId);
  }

  return { points, anchors };
}
