import type { GlyphInfo } from "@shift/glyph-info";
import { asGlyphIndex } from "@shift/types";
import type { CatalogAxis, CatalogDirectory, CatalogMetrics } from "@shift/types";
import { PreviewGlyphAtlasSource } from "@/lib/graphics/backends/PreviewGlyphAtlasSource";
import { signal, type Signal, type WritableSignal } from "@/lib/signals";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type { CatalogGlyphKey } from "@/types/glyphAtlas";
import type { CatalogLocation, GlyphCatalogItem, GlyphCatalogSource } from "@/types/glyphCatalog";
import { glyphCatalogItem } from "./glyphCatalogItem";

/** Owns the immutable retained directory and mutable preview location. */
export class PreviewGlyphCatalogSource implements GlyphCatalogSource {
  readonly #locationCell: WritableSignal<CatalogLocation>;

  readonly glyphsCell: Signal<readonly GlyphCatalogItem[]>;
  readonly axesCell: Signal<readonly CatalogAxis[]>;
  readonly metricsCell: Signal<CatalogMetrics>;
  readonly familyNameCell: Signal<string | null>;
  readonly styleNameCell: Signal<string | null>;
  readonly sourceIdCell = signal<null>(null, { name: "catalog.preview.sourceId" });
  readonly invalidGlyphKeysCell: Signal<readonly CatalogGlyphKey[] | null>;
  readonly atlas: PreviewGlyphAtlasSource;

  constructor(directory: CatalogDirectory, client: FontSessionClient, glyphInfo: GlyphInfo) {
    const metrics = directory.metrics;
    if (!metrics) throw new Error("preview source has no catalog metrics");

    this.glyphsCell = signal(
      directory.glyphs.map((glyph) =>
        glyphCatalogItem(asGlyphIndex(glyph.index), glyph.name, glyph.unicodes, glyphInfo),
      ),
      { name: "catalog.preview.glyphs" },
    );
    this.axesCell = signal(directory.axes, { name: "catalog.preview.axes" });
    this.#locationCell = signal([...directory.defaultLocation], {
      name: "catalog.preview.location",
      equals: sameLocation,
    });
    this.metricsCell = signal(metrics, { name: "catalog.preview.metrics" });
    this.familyNameCell = signal(directory.familyName ?? null, {
      name: "catalog.preview.familyName",
    });
    this.styleNameCell = signal(directory.styleName ?? null, {
      name: "catalog.preview.styleName",
    });
    this.invalidGlyphKeysCell = signal(null, { name: "catalog.preview.invalidGlyphKeys" });
    this.atlas = new PreviewGlyphAtlasSource(client);
  }

  get locationCell(): Signal<CatalogLocation> {
    return this.#locationCell;
  }

  async setLocation(location: CatalogLocation): Promise<void> {
    const axes = this.axesCell.peek();
    if (location.length !== axes.length) {
      throw new Error(`catalog received ${location.length} coordinates for ${axes.length} axes`);
    }

    for (let index = 0; index < axes.length; index += 1) {
      validateCoordinate(axes[index]!, location[index]!);
    }
    this.#locationCell.set([...location]);
  }

  dispose(): void {}
}

function validateCoordinate(axis: CatalogAxis, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`axis ${axis.tag} coordinate is not finite`);

  switch (axis.kind) {
    case "continuous":
      if (axis.minimum === undefined || axis.maximum === undefined) {
        throw new Error(`continuous axis ${axis.tag} has incomplete bounds`);
      }
      if (value < axis.minimum || value > axis.maximum) {
        throw new Error(`axis ${axis.tag} coordinate ${value} is outside its bounds`);
      }
      return;
    case "discrete":
      if (!axis.values.includes(value)) {
        throw new Error(`axis ${axis.tag} does not contain coordinate ${value}`);
      }
      return;
    default:
      throw new Error(`unsupported catalog axis kind ${axis.kind}`);
  }
}

function sameLocation(left: CatalogLocation, right: CatalogLocation): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
