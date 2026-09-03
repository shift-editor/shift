import type { GlyphInfo } from "@shift/glyph-info";
import type {
  Axis,
  CatalogAxis,
  CatalogMetrics,
  GlyphId,
  GlyphName,
  GlyphPreview,
  SourceId,
} from "@shift/types";
import { computed, type ComputedSignal, type Signal } from "@/lib/signals";
import type { Editor } from "@/lib/editor/Editor";
import { externalAxisLocationFromRecord, mapAxisLocation } from "@/lib/variation/location";
import type { GlyphAtlasSource } from "@/types/glyphAtlas";
import type { CatalogLocation, GlyphCatalogItem } from "@/types/glyphCatalog";
import { RenderGlyph } from "@/lib/model/RenderGlyph";

/** Projects the editor model into the source-independent catalog boundary. */
export class GlyphCatalog {
  readonly #editor: Editor;
  readonly #derived: readonly ComputedSignal<unknown>[];

  readonly glyphsCell: ComputedSignal<readonly GlyphCatalogItem[]>;
  readonly axesCell: ComputedSignal<readonly CatalogAxis[]>;
  readonly locationCell: ComputedSignal<CatalogLocation>;
  readonly metricsCell: ComputedSignal<CatalogMetrics>;
  readonly familyNameCell: ComputedSignal<string | null>;
  readonly styleNameCell: ComputedSignal<string | null>;
  readonly sourceIdCell: ComputedSignal<SourceId | null>;
  readonly invalidGlyphIdsCell: Signal<readonly GlyphId[] | null>;
  readonly atlas: GlyphAtlasSource;

  constructor(editor: Editor, glyphInfo: GlyphInfo, atlas: GlyphAtlasSource) {
    this.#editor = editor;
    const font = editor.font;

    this.glyphsCell = computed(
      () =>
        font.glyphEntriesCell.value.map((entry) =>
          glyphCatalogItem(entry.id, entry.name, entry.unicodes, glyphInfo),
        ),
      { name: "catalog.glyphs" },
    );
    this.axesCell = computed(() => font.axesCell.value.map(catalogAxis), {
      name: "catalog.axes",
    });
    this.locationCell = computed(
      () => {
        const location = editor.externalLocationCell.value;
        return font.axesCell.value.map((axis) => location.get(axis.id) ?? axis.default);
      },
      { name: "catalog.location" },
    );
    this.metricsCell = computed(
      () => {
        const activeSourceId = editor.activeSourceIdCell.value;
        const metrics = activeSourceId
          ? font.metricsForSource(activeSourceId)
          : font.metricsAtLocation(editor.externalLocationCell.value);
        return {
          unitsPerEm: metrics.unitsPerEm,
          ascender: metrics.ascender,
          descender: metrics.descender,
          lineGap: metrics.lineGap ?? 0,
        };
      },
      { name: "catalog.metrics" },
    );
    this.familyNameCell = computed(() => font.metadataCell.value.familyName ?? null, {
      name: "catalog.familyName",
    });
    this.styleNameCell = computed(() => font.metadataCell.value.styleName ?? null, {
      name: "catalog.styleName",
    });
    this.sourceIdCell = computed(() => editor.activeSourceIdCell.value, {
      name: "catalog.sourceId",
    });
    this.invalidGlyphIdsCell = font.invalidGlyphIdsCell;
    this.atlas = atlas;
    this.#derived = [
      this.glyphsCell,
      this.axesCell,
      this.locationCell,
      this.metricsCell,
      this.familyNameCell,
      this.styleNameCell,
      this.sourceIdCell,
    ];
  }

  async glyphPreviews(
    glyphIds: readonly GlyphId[],
    location: CatalogLocation,
  ): Promise<readonly GlyphPreview[]> {
    const font = this.#editor.font;
    const axes = font.getAxes();
    if (location.length !== axes.length) {
      throw new Error(`catalog received ${location.length} coordinates for ${axes.length} axes`);
    }

    const externalLocation = externalAxisLocationFromRecord(
      Object.fromEntries(axes.map((axis, index) => [axis.id, location[index] ?? axis.default])),
    );
    const designLocation = mapAxisLocation(externalLocation, axes, font.getAxisMappingBases());
    return font.glyphPreviews(glyphIds, designLocation);
  }

  async openGlyph(glyphId: GlyphId): Promise<RenderGlyph> {
    const glyph = await this.#editor.font.loadGlyph(glyphId);
    return new RenderGlyph(
      glyph.renderModelAt(this.#editor.externalLocationCell, this.#editor.activeSourceIdCell),
    );
  }

  async setLocation(location: CatalogLocation): Promise<void> {
    const axes = this.#editor.font.getAxes();
    if (location.length !== axes.length) {
      throw new Error(`catalog received ${location.length} coordinates for ${axes.length} axes`);
    }

    const axisLocation = externalAxisLocationFromRecord(
      Object.fromEntries(axes.map((axis, index) => [axis.id, location[index] ?? axis.default])),
    );
    this.#editor.setExternalLocation(axisLocation);
  }

  dispose(): void {
    for (const cell of this.#derived) cell.dispose();
  }
}

function glyphCatalogItem(
  id: GlyphId,
  name: GlyphName,
  unicodes: readonly number[],
  glyphInfo: GlyphInfo,
): GlyphCatalogItem {
  const unicode = unicodes[0] ?? null;

  return {
    id,
    name,
    displayName: glyphInfo.resolveGlyphName(name, unicode),
    unicode,
  };
}

function catalogAxis(axis: Axis, index: number): CatalogAxis {
  return {
    index,
    tag: axis.tag,
    name: axis.name,
    hidden: axis.hidden,
    axisType: axis.axisType,
    minimum: axis.minimum,
    default: axis.default,
    maximum: axis.maximum,
    values: axis.values ?? [],
  };
}
