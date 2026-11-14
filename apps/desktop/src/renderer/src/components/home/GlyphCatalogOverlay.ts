import type { Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { Canvas2DSurface } from "@shift/editor/rendering";
import { fitCanvasText } from "@/lib/graphics/canvasText";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import type { GlyphCatalogFrame } from "@/types/glyphCatalog";

const LABEL_HORIZONTAL_INSET = 8;
const HOVER_RADIUS = 4;
/** The selection ring sits this far outside a glyph's preview, and is this wide. */
const SELECTION_RING_OFFSET = 2;
const SELECTION_RING_WIDTH = 2;
/** How opaque the fill of the box dragged to select glyphs is. */
const SELECTION_BOX_FILL_ALPHA = 0.12;

/** Owns the Canvas2D catalog chrome and temporary DOM input placement. */
/** What the overlay marks on top of the glyphs. */
export interface GlyphCatalogOverlayState {
  /** The cell whose preview is under the pointer, by catalog index. */
  readonly hoveredPreviewIndex: number | null;
  /** The cell whose name is under the pointer, by catalog index. */
  readonly hoveredNameIndex: number | null;
  readonly selection: GlyphSelection;
  /** The box being dragged to select glyphs, in the scrolled content; null when none is. */
  readonly selectionBox: Rect2D | null;
  /** Glyphs with no outline, drawn as their character in a muted colour. */
  readonly emptyGlyphIds: ReadonlySet<GlyphId>;
}

export class GlyphCatalogOverlay {
  readonly #canvas: HTMLCanvasElement;
  #inputContainer: HTMLDivElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  setInputContainer(container: HTMLDivElement | null): void {
    this.#inputContainer = container;
  }

  positionInput(frame: GlyphCatalogFrame, glyphId: GlyphId): boolean {
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

  draw(container: HTMLElement, frame: GlyphCatalogFrame, state: GlyphCatalogOverlayState): void {
    const { hoveredPreviewIndex, hoveredNameIndex, selection, selectionBox, emptyGlyphIds } = state;
    const context = Canvas2DSurface.from(this.#canvas).ctx;
    const style = getComputedStyle(container);
    const mutedColor = style.getPropertyValue("--color-muted").trim() || style.color;
    const hoverColor = style.getPropertyValue("--color-hover").trim() || style.color;
    const inputColor = style.getPropertyValue("--color-input").trim() || hoverColor;
    const accentColor = style.getPropertyValue("--color-accent").trim() || style.color;
    const fontFamily = style.fontFamily;
    context.clearRect(0, 0, frame.layout.viewportWidth, frame.layout.viewportHeight);

    for (const cell of frame.cells) {
      const selected = selection.has(cell.glyph.id);
      // A selected glyph keeps the hover fill, so it stays marked once the pointer leaves.
      if (cell.catalogIndex === hoveredPreviewIndex || selected) {
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

      // The ring goes outside the preview and leaves the name alone.
      if (selected) {
        const offset = SELECTION_RING_OFFSET + SELECTION_RING_WIDTH / 2;
        context.strokeStyle = accentColor;
        context.lineWidth = SELECTION_RING_WIDTH;
        context.beginPath();
        context.roundRect(
          cell.previewRect.x - offset,
          cell.previewRect.y - offset,
          cell.previewRect.width + 2 * offset,
          cell.previewRect.height + 2 * offset,
          HOVER_RADIUS + offset,
        );
        context.stroke();
      }

      if (cell.glyph.unicode !== null && emptyGlyphIds.has(cell.glyph.id)) {
        context.fillStyle = mutedColor;
        context.font = "32px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          String.fromCodePoint(cell.glyph.unicode),
          cell.previewRect.x + cell.previewRect.width / 2,
          cell.previewRect.y + cell.previewRect.height / 2,
          cell.previewContentRect.width,
        );
      }

      // The name is a field: a shade darker under the pointer, like the sidebar's inputs.
      context.fillStyle = cell.catalogIndex === hoveredNameIndex ? hoverColor : inputColor;
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

    if (selectionBox) {
      const top = selectionBox.top - frame.scrollTop;
      context.strokeStyle = accentColor;
      context.fillStyle = accentColor;
      context.lineWidth = 1;
      context.globalAlpha = SELECTION_BOX_FILL_ALPHA;
      context.fillRect(selectionBox.left, top, selectionBox.width, selectionBox.height);
      context.globalAlpha = 1;
      context.strokeRect(
        selectionBox.left + 0.5,
        top + 0.5,
        selectionBox.width,
        selectionBox.height,
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
