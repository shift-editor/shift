import type {
  ClipboardImporter,
  ClipboardOffer,
  ContourContent,
  PointContent,
  ShiftContent,
} from "../types";
import { loadEngine } from "../../wasm/engine";
import type { ContourPoints } from "../../wasm/engineModule";

export class SvgImporter implements ClipboardImporter {
  readonly id = "svg";

  pick(offers: readonly ClipboardOffer[]): ClipboardOffer | null {
    return (
      offers.find((offer) => offer.text !== undefined && this.#canImportText(offer.text)) ?? null
    );
  }

  async import(offer: ClipboardOffer): Promise<ShiftContent | null> {
    if (offer.text === undefined) return null;
    return this.importText(offer.text);
  }

  canImportText(text: string): boolean {
    return this.#canImportText(text);
  }

  /**
   * Contours from SVG text: a `<path>` element's `d`, or bare path data.
   *
   * @remarks
   * shift-font parses the path data, in the window's engine module, which
   * this loads on first use.
   */
  async importText(text: string): Promise<ShiftContent | null> {
    const trimmed = text.trim();

    const pathData = this.#extractPathData(trimmed);
    if (!pathData) return null;

    const { svgPathContours } = await loadEngine();
    const codeUnits = Array.from({ length: pathData.length }, (_, index) =>
      pathData.charCodeAt(index),
    );
    const parsed = svgPathContours({ codeUnits });
    if (!parsed || parsed.length === 0) return null;

    return { contours: parsed.map(contourContent) };
  }

  #canImportText(text: string): boolean {
    const trimmed = text.trim();
    return (
      trimmed.includes("<svg") || trimmed.includes("<path") || this.#looksLikePathData(trimmed)
    );
  }

  #looksLikePathData(text: string): boolean {
    return /^[MmZzLlHhVvCcSsQqTtAa0-9\s,.\-+eE]+$/.test(text) && /[MmLlCcQqSsAa]/.test(text);
  }

  #extractPathData(text: string): string | null {
    if (this.#looksLikePathData(text)) {
      return text;
    }

    const pathMatch = text.match(/d\s*=\s*["']([^"']+)["']/);
    if (pathMatch) {
      return pathMatch.at(1) ?? null;
    }

    return null;
  }
}

/** One parsed subpath as portable content; every point is a corner. */
function contourContent(contour: ContourPoints): ContourContent {
  const points: PointContent[] = contour.pointTypes.map((pointType, index) => ({
    x: contour.coordinates[index * 2]!,
    y: contour.coordinates[index * 2 + 1]!,
    pointType,
    smooth: false,
  }));
  return { points, closed: contour.closed };
}
