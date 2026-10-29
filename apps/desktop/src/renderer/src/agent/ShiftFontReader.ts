import type {
  AuthoredLayer,
  AxisCoordinate,
  AxisSelector,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  InstanceSelector,
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
import {
  asGlyphId,
  type Axis,
  type GlyphId,
  type GlyphName,
  type LayerMatch,
  type NamedInstance,
  type Source,
  type Unicode,
} from "@shift/types";
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
      axisMappings: font.getAxisMappings(),
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

  /** The glyph named `name`, or null when the font has none. */
  glyphNamed(name: GlyphName): GlyphSummary | null {
    const entry = this.#font.entryForName(name);
    return entry ? this.#glyphSummary(entry.id) : null;
  }

  /** The glyph the font shows for `unicode`, or null when it has none. */
  glyphForUnicode(unicode: number): GlyphSummary | null {
    const font = this.#font;
    const record = font.recordForName(font.glyphHandleForUnicode(unicode as Unicode).name);
    return record ? this.#glyphSummary(record.id) : null;
  }

  /** The font's default source: where every axis sits at its default. */
  defaultSource(): Source {
    return this.#font.defaultSource;
  }

  /**
   * The source `selector` names, as `sources.get` returns it.
   *
   * @throws {Error} when the font has no such source, or several sources share the name.
   */
  getSource(selector: SourceSelector): Source {
    return this.#font.source(this.#select.sourceId(selector))!;
  }

  /**
   * The source `selector` names, or null when the font has none.
   *
   * @throws {Error} when several sources share the name.
   */
  source(selector: SourceSelector): Source | null {
    const font = this.#font;
    return selector.name !== undefined
      ? font.sourceNamed(selector.name)
      : font.source(selector.sourceId);
  }

  /**
   * The named instance `selector` names, as `instances.get` returns it.
   *
   * @throws {Error} when the font has no such instance, or several instances share the name.
   */
  getInstance(selector: InstanceSelector): NamedInstance {
    const instance = this.instance(selector);
    if (!instance) {
      throw new Error(`Instance ${selector.name ?? selector.instanceId} is not in this font`);
    }
    return instance;
  }

  /**
   * The named instance `selector` names, or null when the font has none.
   *
   * @throws {Error} when several instances share the name.
   */
  instance(selector: InstanceSelector): NamedInstance | null {
    const font = this.#font;
    return selector.name !== undefined
      ? font.namedInstanceNamed(selector.name)
      : font.namedInstance(selector.instanceId);
  }

  /** The axis `selector` names, by id or tag, or null when the font has none. */
  axis(selector: AxisSelector): Axis | null {
    const font = this.#font;
    return selector.tag !== undefined ? font.axisTagged(selector.tag) : font.axis(selector.axisId);
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

  /**
   * How the `target` layer's contours, points, anchors and components
   * correspond to the `reference` layer's, as the engine matches them.
   *
   * @throws {Error} as {@link getLayer} does, for either layer.
   */
  async matchLayers(reference: LayerSelector, target: LayerSelector): Promise<LayerMatch> {
    return this.#font.matchLayers(this.#select.layerId(reference), this.#select.layerId(target));
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
