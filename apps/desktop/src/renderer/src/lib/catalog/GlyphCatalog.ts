import type { GlyphInfo } from "@shift/glyph-info";
import type { Axis, CatalogAxis, CatalogMetrics, GlyphId, GlyphName, SourceId } from "@shift/types";
import { computed, type ComputedSignal, type Signal } from "@/lib/signals";
import type { Editor } from "@/lib/editor/Editor";
import type { AxisLocation } from "@/types/variation";
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
        const location = editor.designLocationCell.value;
        return font.axesCell.value.map((axis) => location.get(axis.id) ?? axis.default);
      },
      { name: "catalog.location" },
    );
    this.metricsCell = computed(
      () => {
        const metrics = font.metricsAtLocation(editor.designLocationCell.value);
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
    const sourceCell = font.sourceAtCell(editor.designLocationCell);
    this.sourceIdCell = computed(() => sourceCell.value?.id ?? null, {
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
      sourceCell,
      this.sourceIdCell,
    ];
  }

  async openGlyph(glyphId: GlyphId): Promise<RenderGlyph> {
    const glyph = await this.#editor.font.loadGlyph(glyphId);
    return new RenderGlyph(glyph.renderModelAt(this.#editor.designLocationCell));
  }

  async setLocation(location: CatalogLocation): Promise<void> {
    const axes = this.#editor.font.getAxes();
    if (location.length !== axes.length) {
      throw new Error(`catalog received ${location.length} coordinates for ${axes.length} axes`);
    }

    const axisLocation: AxisLocation = new Map(
      axes.map((axis, index) => [axis.id, location[index] ?? axis.default]),
    );
    this.#editor.setDesignLocation(axisLocation);
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
