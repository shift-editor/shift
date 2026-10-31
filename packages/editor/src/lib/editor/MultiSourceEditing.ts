import { Bounds, type Rect2D } from "@shift/geo";
import type {
  AnchorId,
  ComponentId,
  GlyphId,
  LayerId,
  LayerMatch,
  PointId,
  SourceId,
} from "@shift/types";
import type { ExternalAxisLocation } from "../../types/variation";
import type { Font } from "../model/Font";
import type { Glyph, GlyphLayer } from "../model/Glyph";
import { effect, signal, track, type Effect, type Signal } from "../signals";
import type {
  ComponentTransformSelection,
  ComponentTransformSelectionLayer,
} from "../../types/componentTransform";
import type { ComponentLayerTargets, ComponentTargets } from "../../types/componentTargets";
import type { PositionSelection, PositionSelectionLayer } from "../../types/positionEdit";
import type { SourceRenderInputs } from "../../types/glyphRender";
import { externalAxisLocationsEqual } from "../variation/location";
import { LatestRequest } from "../utils/LatestRequest";
import type { Scene } from "./Scene";
import { PositionTargets } from "../model/positions/PositionTargets";

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
  // non-reactive: reuses each source's render-model input cells so Glyph's cell-keyed render-model cache hits.
  readonly #sourceRenderInputs = new Map<SourceId, SourceRenderInputs>();
  readonly #effect: Effect;

  #inputs: readonly unknown[] = [];
  #matching: Promise<void> = Promise.resolve();

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

  /** Resolves once the latest requested matches are derived (or superseded). */
  matched(): Promise<void> {
    return this.#matching;
  }

  /** Returns the live matches keyed by non-reference layer ID. */
  get matchesCell(): Signal<ReadonlyMap<LayerId, LayerMatch>> {
    return this.#matchesCell;
  }

  /**
   * Returns a glyph's layer at each source selected for editing, in source order.
   *
   * @returns `null` when the glyph is not loaded or lacks a layer at one of them.
   */
  layersFor(glyphId: GlyphId): GlyphLayer[] | null {
    const glyph = this.#glyphForId(glyphId);
    if (!glyph) return null;

    const editingSourceIds = this.#editingSourceIdsCell.peek();
    const layers: GlyphLayer[] = [];
    for (const source of this.#font.sources) {
      if (!editingSourceIds.has(source.id)) continue;
      const layer = glyph.layerForSource(source.id);
      if (!layer) return null;
      layers.push(layer);
    }
    return layers.length === editingSourceIds.size ? layers : null;
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

  /**
   * Matches direct component targets across every selected editing source.
   *
   * @param reference - Active-source component identities to map through precomputed layer matches.
   * @returns Complete source-layer targets, or `null` when any selected source cannot participate.
   */
  matchComponentTargets(reference: ComponentLayerTargets): ComponentTargets | null {
    const editingSourceIds = this.#editingSourceIdsCell.peek();
    if (editingSourceIds.size <= 1) return { ...reference, additionalLayers: [] };

    const glyph = this.#glyphForLayer(reference.layer);
    if (!glyph) return null;

    const activeSourceId = this.#activeSourceIdCell.peek();
    if (!activeSourceId) return null;

    const matches = this.#matchesCell.peek();
    const additionalLayers: ComponentLayerTargets[] = [];
    for (const source of this.#font.sources) {
      if (source.id === activeSourceId || !editingSourceIds.has(source.id)) continue;

      const targetLayer = glyph.layerForSource(source.id);
      if (!targetLayer) return null;

      const layerMatch = matches.get(targetLayer.id);
      if (!layerMatch?.complete || layerMatch.referenceLayerId !== reference.layer.id) return null;

      const componentIds = mapComponentIds(reference.componentIds, layerMatch);
      if (!componentIds) return null;

      additionalLayers.push({ layer: targetLayer, componentIds });
    }

    return { ...reference, additionalLayers };
  }

  /**
   * Maps direct components onto every selected source layer and resolves transform pivots.
   *
   * @param reference - Active-source component identities and resolved local bounds.
   * @returns The complete matched selection, or `null` when any source cannot participate.
   */
  resolveComponents(
    reference: ComponentTransformSelectionLayer,
  ): ComponentTransformSelection | null {
    const targets = this.matchComponentTargets(reference);
    if (!targets) return null;

    const glyph = this.#glyphForLayer(reference.layer);
    if (!glyph) return null;

    const additionalLayers: ComponentTransformSelectionLayer[] = [];
    for (const target of targets.additionalLayers) {
      const bounds = this.#componentBounds(
        glyph,
        target.layer.sourceId,
        target.layer,
        target.componentIds,
      );
      if (!bounds) return null;

      additionalLayers.push({ ...target, bounds });
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

    this.#matching = this.#resolveMatches(layerPairs);
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

  #componentBounds(
    glyph: Glyph,
    sourceId: SourceId,
    layer: GlyphLayer,
    componentIds: readonly ComponentId[],
  ): Rect2D | null {
    const location = this.#font.externalLocationForSource(sourceId);
    if (!location) return null;

    const inputs = this.#renderInputsFor(sourceId, location);
    const view = glyph.renderModelAt(inputs.locationCell, inputs.sourceIdCell);
    // Render paths keep projection-stable identities even when exact-source authored IDs differ.
    // Resolve the authored target IDs to their Rust-matched direct-component slots.
    const directComponents = view.components.filter(
      (component) => component.parentPath.length === 0,
    );
    const bounds = Bounds.unionAll(
      componentIds.map((componentId) => {
        const componentIndex = layer.components.findIndex(({ id }) => id === componentId);
        return componentIndex === -1 ? null : (directComponents[componentIndex]?.bounds ?? null);
      }),
    );
    return bounds ? Bounds.toRect(bounds) : null;
  }

  /** Returns this source's render-model cells, new only when its location changed. */
  #renderInputsFor(sourceId: SourceId, location: ExternalAxisLocation): SourceRenderInputs {
    const cached = this.#sourceRenderInputs.get(sourceId);
    if (cached && externalAxisLocationsEqual(cached.location, location)) return cached;

    const inputs: SourceRenderInputs = {
      location,
      locationCell: signal(location),
      sourceIdCell: signal<SourceId | null>(sourceId),
    };
    this.#sourceRenderInputs.set(sourceId, inputs);
    return inputs;
  }

  #glyphForLayer(layer: GlyphLayer): Glyph | null {
    const glyphId = this.#font.glyphIdForLayer(layer.id);
    return glyphId ? this.#glyphForId(glyphId) : null;
  }
}

function mapComponentIds(
  componentIds: readonly ComponentId[],
  match: LayerMatch,
): readonly ComponentId[] | null {
  const componentMatches = new Map(
    match.components.map((componentMatch) => [componentMatch.referenceId, componentMatch.targetId]),
  );
  const targets: ComponentId[] = [];
  for (const componentId of componentIds) {
    const targetId = componentMatches.get(componentId);
    if (!targetId) return null;

    targets.push(targetId);
  }
  return targets;
}

function mapTargets(reference: PositionSelectionLayer, match: LayerMatch): PositionTargets | null {
  const pointMatches = new Map(
    match.points.map((pointMatch) => [pointMatch.referenceId, pointMatch.targetId]),
  );
  const anchorMatches = new Map(
    match.anchors.map((anchorMatch) => [anchorMatch.referenceId, anchorMatch.targetId]),
  );
  const points: PointId[] = [];
  for (const pointId of reference.targets.points) {
    const targetPointId = pointMatches.get(pointId);
    if (!targetPointId) return null;
    points.push(targetPointId);
  }
  const anchors: AnchorId[] = [];
  for (const anchorId of reference.targets.anchors) {
    const targetAnchorId = anchorMatches.get(anchorId);
    if (!targetAnchorId) return null;
    anchors.push(targetAnchorId);
  }

  return new PositionTargets(points, anchors);
}
