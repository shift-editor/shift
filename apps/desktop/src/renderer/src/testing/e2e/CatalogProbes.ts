import type { AxisId, GlyphId } from "@shift/types";
import type { FontSession } from "@/types/fontSession";

/**
 * The Home glyph catalog's preview location, and a frame sampler for its rename transition,
 * for E2E specs.
 *
 * @remarks
 * Served through the E2E hook for test launches only.
 */
export class CatalogProbes {
  readonly #session: FontSession;

  constructor(session: FontSession) {
    this.#session = session;
  }

  /** The location the catalog previews glyphs at, one coordinate per axis in font axis order. */
  location(): readonly number[] {
    return [...this.#session.catalog.locationCell.peek()];
  }

  /** The catalog's coordinate on the axis `axisId`, and the source it previews exactly (null between sources). */
  locationOn(axisId: AxisId): { location: number | undefined; sourceId: string | null } {
    const catalog = this.#session.catalog;
    const axisIndex = this.#session.font.getAxes().findIndex((axis) => axis.id === axisId);
    return {
      location: catalog.locationCell.peek()[axisIndex],
      sourceId: catalog.sourceIdCell.peek() ?? null,
    };
  }

  /**
   * Resolves, after the rename field closes, whether the catalog showed `nextName` from the
   * moment it stopped showing the old name until the font confirmed the rename, sampled each
   * frame; false when the old name came back in between.
   */
  observeRenameTransition(glyphId: GlyphId, nextName: string): Promise<boolean> {
    const font = this.#session.font;
    return new Promise<boolean>((resolve) => {
      const sample = (): void => {
        const currentName = font.recordForId(glyphId)?.name;
        const input = document.querySelector<HTMLInputElement>('[aria-label="Glyph name"]');
        const renderer = [
          ...document.querySelectorAll<HTMLElement>("[data-glyph-catalog-renderer]"),
        ].find((element) => getComputedStyle(element).visibility === "visible");
        if (input) {
          requestAnimationFrame(sample);
          return;
        }

        const visibleName = renderer?.dataset.firstGlyphName;
        if (currentName === nextName) {
          resolve(visibleName === nextName);
          return;
        }
        if (visibleName !== nextName) {
          resolve(false);
          return;
        }

        requestAnimationFrame(sample);
      };

      requestAnimationFrame(sample);
    });
  }
}
