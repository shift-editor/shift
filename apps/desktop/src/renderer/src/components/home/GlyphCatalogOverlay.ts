import type { CatalogGlyphKey } from "@/types/glyphAtlas";
import { Canvas2DSurface } from "@/lib/editor/rendering/CanvasSurface";
import { fitCanvasText } from "@/lib/graphics/canvasText";
import type { GlyphCatalogFrame } from "@/types/glyphCatalog";

const LABEL_HORIZONTAL_INSET = 8;
const HOVER_RADIUS = 4;

/** Owns the Canvas2D catalog chrome and temporary DOM input placement. */
export class GlyphCatalogOverlay {
  readonly #canvas: HTMLCanvasElement;
  #inputContainer: HTMLDivElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  setInputContainer(container: HTMLDivElement | null): void {
    this.#inputContainer = container;
  }

  positionInput(frame: GlyphCatalogFrame, glyphId: CatalogGlyphKey): boolean {
    const container = this.#inputContainer;
    if (!container) return false;

    const cell = frame.cells.find((candidate) => candidate.glyph.id === glyphId);
    if (!cell || cell.nameRect.bottom <= 0 || cell.nameRect.top >= frame.layout.viewportHeight) {
      return false;
    }

    container.style.width = `${cell.nameRect.width}px`;
    container.style.height = `${cell.nameRect.height}px`;
    container.style.transform = `translate(${cell.nameRect.x}px, ${cell.nameRect.y}px)`;
    return true;
  }

  draw(container: HTMLElement, frame: GlyphCatalogFrame, hoveredCatalogIndex: number | null): void {
    const context = Canvas2DSurface.from(this.#canvas).ctx;
    const style = getComputedStyle(container);
    const mutedColor = style.getPropertyValue("--color-muted").trim() || style.color;
    const hoverColor = style.getPropertyValue("--color-hover").trim() || style.color;
    const inputColor = style.getPropertyValue("--color-input").trim() || hoverColor;
    const fontFamily = style.fontFamily;
    context.clearRect(0, 0, frame.layout.viewportWidth, frame.layout.viewportHeight);

    for (const cell of frame.cells) {
      if (cell.catalogIndex === hoveredCatalogIndex) {
        context.fillStyle = hoverColor;
        context.beginPath();
        context.roundRect(
          cell.previewRect.x,
          cell.previewRect.y,
          cell.previewRect.width,
          cell.previewRect.height,
          HOVER_RADIUS,
        );
        context.fill();
      }

      context.fillStyle = inputColor;
      context.beginPath();
      context.roundRect(
        cell.nameRect.x,
        cell.nameRect.y,
        cell.nameRect.width,
        cell.nameRect.height,
        HOVER_RADIUS,
      );
      context.fill();

      context.fillStyle = mutedColor;
      context.font = `400 10px ${fontFamily}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        fitCanvasText(
          context,
          cell.glyph.displayName,
          cell.nameRect.width - 2 * LABEL_HORIZONTAL_INSET,
        ),
        cell.nameRect.x + cell.nameRect.width / 2,
        cell.nameRect.y + cell.nameRect.height / 2,
      );
    }

    if (frame.layout.glyphCount > 0) return;

    context.fillStyle = mutedColor;
    context.font = `400 12px ${fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "No glyphs match this filter.",
      frame.layout.viewportWidth / 2,
      frame.layout.viewportHeight / 2,
    );
  }
}
