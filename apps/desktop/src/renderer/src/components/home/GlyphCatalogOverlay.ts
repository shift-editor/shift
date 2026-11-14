import type { Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { Canvas2DSurface } from "@shift/editor/rendering";
import { fitCanvasText } from "@/lib/graphics/canvasText";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import { resolvedMarkColor } from "@/lib/glyph-grid/markColor";
import type { GlyphCatalogFrame } from "@/types/glyphCatalog";

const LABEL_HORIZONTAL_INSET = 8;
/** A tile is a card: slightly rounded, with a hard shadow down and to the right. */
const TILE_RADIUS = 2;
const TILE_SHADOW_OFFSET = 2;
/** How much of the tile's ink darkens the part of a tile under the pointer. */
const TILE_HOVER_ALPHA = 0.2;
/** The character drawn for an empty glyph, as a fraction of the preview's height. */
const EMPTY_GLYPH_FONT_RATIO = 0.43;
/** The selection ring sits this far outside a tile, and is this wide. */
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
    const token = (name: string) => style.getPropertyValue(name).trim() || style.color;
    const inputColor = token("--color-input");
    const tileColor = token("--color-tile");
    const inkColor = token("--color-tile-ink");
    const shadowColor = token("--color-tile-shadow");
    const accentColor = style.getPropertyValue("--color-accent").trim() || style.color;
    const fontFamily = style.fontFamily;
    context.clearRect(0, 0, frame.layout.viewportWidth, frame.layout.viewportHeight);

    for (const cell of frame.cells) {
      const tile = cell.cellRect;
      const { markColor } = cell.glyph;

      // A hard shadow down and to the right, then the tile over it.
      context.fillStyle = shadowColor;
      context.beginPath();
      context.roundRect(
        tile.x + TILE_SHADOW_OFFSET,
        tile.y + TILE_SHADOW_OFFSET,
        tile.width,
        tile.height,
        TILE_RADIUS,
      );
      context.fill();
      // Cleared first, so a translucent fill does not show the shadow under it.
      context.clearRect(tile.x, tile.y, tile.width, tile.height);
      context.fillStyle = markColor ? resolvedMarkColor(markColor, style) : tileColor;
      context.beginPath();
      context.roundRect(tile.x, tile.y, tile.width, tile.height, TILE_RADIUS);
      context.fill();

      // The name is a field that stays grey whatever the tile's colour.
      context.clearRect(
        cell.nameRect.x,
        cell.nameRect.y,
        cell.nameRect.width,
        cell.nameRect.height,
      );
      context.fillStyle = inputColor;
      context.beginPath();
      context.roundRect(
        cell.nameRect.x,
        cell.nameRect.y,
        cell.nameRect.width,
        cell.nameRect.height,
        [0, 0, TILE_RADIUS, TILE_RADIUS],
      );
      context.fill();

      // Each part of a tile darkens only under the pointer: the preview or the name.
      const hovered = cell.catalogIndex === hoveredPreviewIndex;
      const hoveredName = cell.catalogIndex === hoveredNameIndex;
      if (hovered || hoveredName) {
        const top = hovered ? tile.y : cell.nameRect.y;
        const bottom = hovered ? cell.nameRect.y : tile.bottom;
        context.globalAlpha = TILE_HOVER_ALPHA;
        context.fillStyle = inkColor;
        context.fillRect(tile.x, top, tile.width, bottom - top);
        context.globalAlpha = 1;
      }

      context.strokeStyle = inkColor;
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(tile.x + 0.5, tile.y + 0.5, tile.width - 1, tile.height - 1, TILE_RADIUS);
      context.moveTo(tile.x, cell.nameRect.y + 0.5);
      context.lineTo(tile.right, cell.nameRect.y + 0.5);
      context.stroke();

      // The ring goes outside the tile.
      if (selection.has(cell.glyph.id)) {
        const offset = SELECTION_RING_OFFSET + SELECTION_RING_WIDTH / 2;
        context.strokeStyle = accentColor;
        context.lineWidth = SELECTION_RING_WIDTH;
        context.beginPath();
        context.roundRect(
          tile.x - offset,
          tile.y - offset,
          tile.width + 2 * offset,
          tile.height + 2 * offset,
          TILE_RADIUS + offset,
        );
        context.stroke();
      }

      if (cell.glyph.unicode !== null && emptyGlyphIds.has(cell.glyph.id)) {
        context.fillStyle = mutedColor;
        context.font = `${Math.round(cell.previewRect.height * EMPTY_GLYPH_FONT_RATIO)}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          String.fromCodePoint(cell.glyph.unicode),
          cell.previewRect.x + cell.previewRect.width / 2,
          cell.previewRect.y + cell.previewRect.height / 2,
          cell.previewContentRect.width,
        );
      }

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
