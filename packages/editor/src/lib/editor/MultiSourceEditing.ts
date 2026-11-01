import { Bounds, type Rect2D } from "@shift/geo";
import type { ComponentId, GlyphId, SourceId } from "@shift/types";
import type { ExternalAxisLocation } from "../../types/variation";
import type { Font } from "../model/Font";
import type { Glyph, GlyphLayer } from "../model/Glyph";
import { signal, type Signal } from "../signals";
import type {
  ComponentTransformSelection,
  ComponentTransformSelectionLayer,
} from "../../types/componentTransform";
import type { ComponentLayerTargets, ComponentTargets } from "../../types/componentTargets";
import type { PositionSelection, PositionSelectionLayer } from "../../types/positionEdit";
import type { SourceRenderInputs } from "../../types/glyphRender";
import { externalAxisLocationsEqual } from "../variation/location";
import { PositionTargets } from "../model/positions/PositionTargets";

/** Maps the active source's selection onto every other source selected for editing. */
export class MultiSourceEditing {
  readonly #font: Font;
  readonly #glyphForId: (glyphId: GlyphId) => Glyph | null;
  readonly #activeSourceIdCell: Signal<SourceId | null>;
  readonly #editingSourceIdsCell: Signal<ReadonlySet<SourceId>>;
  // non-reactive: reuses each source's render-model input cells so Glyph's cell-keyed render-model cache hits.
  readonly #sourceRenderInputs = new Map<SourceId, SourceRenderInputs>();

  /**
   * @param font - Font whose engine matches the layers.
   * @param glyphForId - Synchronous lookup for completely loaded glyphs.
   * @param activeSourceIdCell - Reference source selected for direct editing.
   * @param editingSourceIdsCell - Complete source set transformed together.
   */
  constructor(
    font: Font,
    glyphForId: (glyphId: GlyphId) => Glyph | null,
    activeSourceIdCell: Signal<SourceId | null>,
    editingSourceIdsCell: Signal<ReadonlySet<SourceId>>,
  ) {
    this.#font = font;
    this.#glyphForId = glyphForId;
    this.#activeSourceIdCell = activeSourceIdCell;
    this.#editingSourceIdsCell = editingSourceIdsCell;
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
   * @returns The complete multi-layer selection, or `null` when any source layer is missing or
   * does not match the reference layer completely.
   */
  resolve(reference: PositionSelectionLayer): PositionSelection | null {
    const targetLayers = this.#targetLayers(reference.layer);
    if (!targetLayers) return null;

    const { points, anchors } = reference.targets;
    const ids = { points, anchors, components: [] };
    const additionalLayers: PositionSelectionLayer[] = [];
    for (const targetLayer of targetLayers) {
      const counterparts = this.#font.counterparts(reference.layer.id, targetLayer.id, ids);
      if (!counterparts) return null;

      additionalLayers.push({
        layer: targetLayer,
        targets: new PositionTargets(counterparts.points, counterparts.anchors),
      });
    }

    return { ...reference, additionalLayers };
  }

  /**
   * Matches direct component targets across every selected editing source.
   *
   * @param reference - Active-source component identities to match in every other source.
   * @returns Complete source-layer targets, or `null` when any selected source cannot participate.
   */
  matchComponentTargets(reference: ComponentLayerTargets): ComponentTargets | null {
    const targetLayers = this.#targetLayers(reference.layer);
    if (!targetLayers) return null;

    const ids = { points: [], anchors: [], components: reference.componentIds };
    const additionalLayers: ComponentLayerTargets[] = [];
    for (const targetLayer of targetLayers) {
      const counterparts = this.#font.counterparts(reference.layer.id, targetLayer.id, ids);
      if (!counterparts) return null;

      additionalLayers.push({ layer: targetLayer, componentIds: counterparts.components });
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

  /**
   * The reference layer's glyph's layers at the other sources selected for editing, in source
   * order; empty when only the active source is; null when the glyph is not loaded, there is no
   * active source, or the glyph lacks a layer at one of them.
   */
  #targetLayers(reference: GlyphLayer): GlyphLayer[] | null {
    const editingSourceIds = this.#editingSourceIdsCell.peek();
    if (editingSourceIds.size <= 1) return [];

    const glyph = this.#glyphForLayer(reference);
    const activeSourceId = this.#activeSourceIdCell.peek();
    if (!glyph || !activeSourceId) return null;

    const targetLayers: GlyphLayer[] = [];
    for (const source of this.#font.sources) {
      if (source.id === activeSourceId || !editingSourceIds.has(source.id)) continue;

      const targetLayer = glyph.layerForSource(source.id);
      if (!targetLayer) return null;

      targetLayers.push(targetLayer);
    }
    return targetLayers;
  }

  #glyphForLayer(layer: GlyphLayer): Glyph | null {
    const glyphId = this.#font.glyphIdForLayer(layer.id);
    return glyphId ? this.#glyphForId(glyphId) : null;
  }
}
