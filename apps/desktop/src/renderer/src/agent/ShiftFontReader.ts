import type {
  AuthoredLayer,
  AxisCoordinate,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftSessionMode,
} from "@shift/runtime";
import type { AxisId, GlyphId, LayerId, SourceId } from "@shift/types";
import type { Font } from "@shift/editor/model";
import {
  axisValue,
  externalAxisLocationFromRecord,
  mapAxisLocation,
  type ExternalAxisLocation,
} from "@shift/editor/variation";
import { ShiftLayer } from "./ShiftLayer";

/**
 * Public font, location, glyph, and layer reads over one renderer's font.
 *
 * @remarks
 * Reads accepted state only and returns runtime DTOs. Revision guarding and
 * transport belong to the caller.
 */
export class ShiftFontReader {
  readonly #font: Font;
  readonly #mode: ShiftSessionMode;

  constructor(font: Font, mode: ShiftSessionMode) {
    this.#font = font;
    this.#mode = mode;
  }

  getFont(): FontOverview {
    const font = this.#font;
    return {
      mode: this.#mode,
      info: font.metadata,
      metrics: font.metrics,
      metricDefinitions: font.metricDefinitions,
      glyphCount: font.glyphEntries().length,
      axes: font.getAxes(),
      sources: font.sources,
      instances: font.namedInstances,
    };
  }

  resolveLocation(location: AxisCoordinate[]): ResolvedLocation {
    const font = this.#font;
    const external = this.#externalLocation(location);
    const design = mapAxisLocation(external, font.getAxes(), font.getAxisMappingBases());

    return {
      externalLocation: font
        .getAxes()
        .map((axis) => ({ axisId: axis.id, value: axisValue(external, axis) })),
      designLocation: font
        .getAxes()
        .map((axis) => ({ axisId: axis.id, value: axisValue(design, axis) })),
      sourceId: font.sourceAt(external)?.id ?? null,
      metrics: font.metricsAtLocation(external),
    };
  }

  /**
   * Lists one directory page; with `sourceId`, nests each glyph's authored layer.
   *
   * @throws {Error} for an invalid limit or cursor, or an unknown source.
   */
  async listGlyphs({
    limit = 25,
    cursor,
    sourceId,
  }: {
    limit?: number;
    cursor?: string;
    sourceId?: SourceId;
  }): Promise<GlyphPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("glyphs.list limit must be between 1 and 100");
    }

    const entries = this.#font.glyphEntries();
    let start = 0;
    if (cursor) {
      let previousId: string;
      try {
        previousId = atob(cursor);
      } catch {
        throw new Error("Invalid glyph cursor");
      }

      const previousIndex = entries.findIndex(({ id }) => id === previousId);
      if (previousIndex < 0) throw new Error("Glyph cursor is no longer in this font");
      start = previousIndex + 1;
    }

    const page = entries.slice(start, start + limit);
    const items = page.map((entry) => this.#glyphSummary(entry.id));
    if (sourceId) {
      const layers = await this.#font.readLayersInSource(
        page.map(({ id }) => id),
        sourceId,
      );
      items.forEach((item, index) => {
        const layer = layers[index];
        item.layer = layer ? ShiftLayer.fromSnapshot(layer).authored() : null;
      });
    }

    const last = page.at(-1);
    return {
      items,
      nextCursor: start + page.length < entries.length && last ? btoa(last.id) : null,
    };
  }

  getGlyph(selector: GlyphSelector): GlyphSummary {
    const entry =
      selector.name !== undefined
        ? this.#font.entryForName(selector.name)
        : this.#font.entryForId(selector.glyphId);
    if (!entry) throw new Error(`Glyph ${selector.name ?? selector.glyphId} is not in this font`);
    return this.#glyphSummary(entry.id);
  }

  async resolveGlyphs(glyphIds: GlyphId[], location: AxisCoordinate[]): Promise<ResolvedGlyphs> {
    const font = this.#font;
    for (const glyphId of glyphIds) {
      if (!font.entryForId(glyphId)) throw new Error(`Glyph ${glyphId} is not in this font`);
    }

    const external = this.#externalLocation(location);
    const design = mapAxisLocation(external, font.getAxes(), font.getAxisMappingBases());
    const previews = await font.glyphPreviews(glyphIds, design);
    const resolvedIds = new Set(previews.map(({ glyphId }) => glyphId));

    return {
      items: previews.map(({ glyphId, svgPath, xAdvance }) => ({
        glyphId,
        svgPath,
        advanceWidth: xAdvance,
      })),
      unresolvedGlyphIds: glyphIds.filter((glyphId) => !resolvedIds.has(glyphId)),
    };
  }

  async getLayer(layerId: LayerId): Promise<AuthoredLayer> {
    return (await ShiftLayer.readAuthored(this.#font, layerId)).authored();
  }

  async resolveLayer(layerId: LayerId): Promise<ResolvedLayer> {
    return (await ShiftLayer.read(this.#font, layerId)).resolved();
  }

  async renderLayer(
    layerId: LayerId,
    options: { overlays?: LayerOverlays; appearance?: LayerAppearance } = {},
  ): Promise<LayerSvg> {
    const layer = await ShiftLayer.read(this.#font, layerId);
    const { sourceId } = layer.identity;
    const metrics = this.#font.source(sourceId)
      ? this.#font.metricsForSource(sourceId)
      : this.#font.defaultSourceMetrics;
    return layer.render(metrics, options);
  }

  #glyphSummary(glyphId: GlyphId): GlyphSummary {
    const entry = this.#font.entryForId(glyphId);
    if (!entry) throw new Error(`Glyph ${glyphId} is not in this font`);

    const record = this.#font.recordForId(glyphId);
    return {
      id: entry.id,
      name: entry.name,
      unicodes: [...entry.unicodes],
      componentBaseGlyphIds: record?.componentBaseGlyphIds ?? [],
      layers: record?.layers.map(({ id, sourceId }) => ({ layerId: id, sourceId })) ?? [],
    };
  }

  #externalLocation(coordinates: AxisCoordinate[]): ExternalAxisLocation {
    const axisIds = new Set<AxisId>(this.#font.getAxes().map(({ id }) => id));
    const values: Record<string, number> = {};
    for (const { axisId, value } of coordinates) {
      if (!axisIds.has(axisId)) throw new Error(`Unknown axis: ${axisId}`);
      if (axisId in values) throw new Error(`Duplicate axis coordinate: ${axisId}`);
      values[axisId] = value;
    }
    return externalAxisLocationFromRecord(values);
  }
}
