import type { GlyphInfo } from "@shift/glyph-info";
import type { Axis, CatalogAxis, CatalogMetrics, GlyphId, SourceId } from "@shift/types";
import { AuthoredGlyphAtlasSource } from "@/lib/graphics/backends/AuthoredGlyphAtlasSource";
import { computed, type ComputedSignal, type Signal } from "@/lib/signals";
import type { Editor } from "@/lib/editor/Editor";
import type { AxisLocation } from "@/types/variation";
import type { CatalogGlyphKey } from "@/types/glyphAtlas";
import type { CatalogLocation, GlyphCatalogItem, GlyphCatalogSource } from "@/types/glyphCatalog";
import type { GlyphRenderInput } from "@/types/glyphRender";
import { glyphRenderInput } from "@/lib/model/glyphRenderInput";
import { glyphCatalogItem } from "./glyphCatalogItem";

/** Projects the authored model into the immutable catalog boundary. */
export class ShiftGlyphCatalogSource implements GlyphCatalogSource {
  readonly #editor: Editor;
  readonly #derived: readonly ComputedSignal<unknown>[];

  readonly glyphsCell: ComputedSignal<readonly GlyphCatalogItem[]>;
  readonly axesCell: ComputedSignal<readonly CatalogAxis[]>;
  readonly locationCell: ComputedSignal<CatalogLocation>;
  readonly metricsCell: ComputedSignal<CatalogMetrics>;
  readonly familyNameCell: ComputedSignal<string | null>;
  readonly styleNameCell: ComputedSignal<string | null>;
  readonly sourceIdCell: ComputedSignal<SourceId | null>;
  readonly invalidGlyphKeysCell: Signal<readonly GlyphId[] | null>;
  readonly atlas: AuthoredGlyphAtlasSource;

  constructor(editor: Editor, glyphInfo: GlyphInfo) {
    this.#editor = editor;
    const font = editor.font;

    this.glyphsCell = computed(
      () =>
        font.glyphRecordsCell.value.map((record) =>
          glyphCatalogItem(record.id, record.name, record.unicodes, glyphInfo),
        ),
      { name: "catalog.shift.glyphs" },
    );
    this.axesCell = computed(() => font.axesCell.value.map(catalogAxis), {
      name: "catalog.shift.axes",
    });
    this.locationCell = computed(
      () => {
        const location = editor.designLocationCell.value;
        return font.axesCell.value.map((axis) => location.get(axis.id) ?? axis.default);
      },
      { name: "catalog.shift.location" },
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
      { name: "catalog.shift.metrics" },
    );
    this.familyNameCell = computed(() => font.metadataCell.value.familyName ?? null, {
      name: "catalog.shift.familyName",
    });
    this.styleNameCell = computed(() => font.metadataCell.value.styleName ?? null, {
      name: "catalog.shift.styleName",
    });
    const sourceCell = font.sourceAtCell(editor.designLocationCell);
    this.sourceIdCell = computed(() => sourceCell.value?.id ?? null, {
      name: "catalog.shift.sourceId",
    });
    this.invalidGlyphKeysCell = font.invalidGlyphIdsCell;
    this.atlas = new AuthoredGlyphAtlasSource(font.editCoordinator, () => font.getAxes());
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

  async openGlyph(glyphKey: CatalogGlyphKey): Promise<GlyphRenderInput> {
    if (typeof glyphKey !== "string") throw new Error("authored catalog received a glyph index");

    const glyph = await this.#editor.font.loadGlyph(glyphKey);
    return glyphRenderInput(glyph.renderModelAt(this.#editor.designLocationCell));
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

function catalogAxis(axis: Axis, index: number): CatalogAxis {
  return {
    index,
    tag: axis.tag,
    name: axis.name,
    hidden: axis.hidden,
    kind: axis.axisType,
    minimum: axis.minimum,
    defaultValue: axis.default,
    maximum: axis.maximum,
    values: axis.values ?? [],
  };
}
