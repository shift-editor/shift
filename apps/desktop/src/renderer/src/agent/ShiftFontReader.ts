import type {
  AuthoredLayer,
  AxisCoordinate,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSelector,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftSessionMode,
  SourceSelector,
} from "@shift/runtime";
import { asGlyphId, type GlyphId } from "@shift/types";
import type { Font } from "@shift/editor/model";
import { ShiftLayer } from "./ShiftLayer";
import { ShiftSelectors } from "./ShiftSelectors";

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
  readonly #select: ShiftSelectors;

  constructor(font: Font, mode: ShiftSessionMode) {
    this.#font = font;
    this.#mode = mode;
    this.#select = new ShiftSelectors(font);
  }

  getFont(): FontOverview {
    const font = this.#font;
    return {
      mode: this.#mode,
      info: font.metadata,
      metrics: font.metrics,
      metricDefinitions: font.metricDefinitions,
      glyphCount: font.glyphCount,
      axes: font.getAxes(),
      sources: font.sources,
      instances: font.namedInstances,
    };
  }

  resolveLocation(location: AxisCoordinate[]): ResolvedLocation {
    const designspace = this.#font.designspace;
    const external = designspace.location(location);

    return {
      externalLocation: designspace.coordinates(external),
      designLocation: designspace.coordinates(designspace.toDesign(external)),
      sourceId: designspace.sourceAt(external)?.id ?? null,
      metrics: this.#font.metricsAtLocation(external),
    };
  }

  /**
   * Lists one directory page; with `source`, nests each glyph's authored layer there.
   *
   * @throws {Error} for an invalid limit or cursor, or an unknown source.
   */
  async listGlyphs({
    limit = 25,
    cursor,
    source,
  }: {
    limit?: number;
    cursor?: string;
    source?: SourceSelector;
  }): Promise<GlyphPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("glyphs.list limit must be between 1 and 100");
    }
    const sourceId = source ? this.#select.sourceId(source) : null;

    const after = cursor ? decodeGlyphCursor(cursor) : null;
    const directory = this.#font.glyphsAfter(after, limit);
    if (!directory) throw new Error("Glyph cursor is no longer in this font");

    const page = directory.entries;
    const items = page.map((entry) => this.#glyphSummary(entry.id));
    if (sourceId) {
      const font = this.#font;
      const snapshots = await font.readLayers(
        page.flatMap(({ id }) => font.layerIdFor(id, sourceId) ?? []),
      );
      const layers = new Map(snapshots.map((snapshot) => [snapshot.glyphId, snapshot]));
      for (const item of items) {
        const layer = layers.get(item.id);
        item.layer = layer ? ShiftLayer.fromSnapshot(layer).authored() : null;
      }
    }

    const last = page.at(-1);
    return {
      items,
      nextCursor: directory.hasMore && last ? btoa(last.id) : null,
    };
  }

  getGlyph(selector: GlyphSelector): GlyphSummary {
    return this.#glyphSummary(this.#select.glyphId(selector));
  }

  async resolveGlyphs(glyphIds: GlyphId[], location: AxisCoordinate[]): Promise<ResolvedGlyphs> {
    const font = this.#font;
    for (const glyphId of glyphIds) this.#select.glyphId({ glyphId });

    const designspace = font.designspace;
    const design = designspace.toDesign(designspace.location(location));
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

  /** @throws {Error} for an unknown layer, glyph or source, or a glyph with no layer at that source. */
  async getLayer(selector: LayerSelector): Promise<AuthoredLayer> {
    return (await ShiftLayer.readAuthored(this.#font, this.#select.layerId(selector))).authored();
  }

  /** @throws {Error} as {@link getLayer} does, or when a component cannot resolve. */
  async resolveLayer(selector: LayerSelector): Promise<ResolvedLayer> {
    return (await ShiftLayer.read(this.#font, this.#select.layerId(selector))).resolved();
  }

  /** @throws {Error} as {@link resolveLayer} does. */
  async renderLayer(
    selector: LayerSelector,
    options: { overlays?: LayerOverlays; appearance?: LayerAppearance } = {},
  ): Promise<LayerSvg> {
    const layer = await ShiftLayer.read(this.#font, this.#select.layerId(selector));
    return layer.render(this.#font.metricsForLayerSource(layer.identity.sourceId), options);
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
}

function decodeGlyphCursor(cursor: string): GlyphId {
  try {
    return asGlyphId(atob(cursor));
  } catch {
    throw new Error("Invalid glyph cursor");
  }
}
