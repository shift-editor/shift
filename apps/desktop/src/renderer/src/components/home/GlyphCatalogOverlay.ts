import { Rect, type Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { Canvas2DSurface } from "@shift/editor/rendering";
import { fitCanvasText } from "@/lib/graphics/canvasText";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import { resolvedMarkColor } from "@/lib/glyph-grid/markColor";
import type { GlyphCatalogCell, GlyphCatalogFrame } from "@/types/glyphCatalog";

const LABEL_HORIZONTAL_INSET = 8;
/** Each glyph is one rounded grey cell: its preview above a band holding its name. A tag colours the band. */
const CELL_RADIUS = 6;
/** How much ink darkens a name band under the pointer. */
const BAND_HOVER_ALPHA = 0.12;
/** The rename field sits inside the band: the compact input's height, centred. */
const NAME_FIELD_HEIGHT = 24;
const NAME_FIELD_INSET_X = 3;
/** The character drawn for an empty glyph, as a fraction of the preview's height. */
const EMPTY_GLYPH_FONT_RATIO = 0.43;
/** How wide the selection ring is; it sits inside the cell's edge. */
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
  /** The glyph being renamed, whose name the input shows instead; null when none is. */
  readonly editingGlyphId: GlyphId | null;
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

    const field = nameFieldRect(cell);
    container.style.width = `${field.width}px`;
    container.style.height = `${field.height}px`;
    container.style.transform = `translate(${field.x}px, ${field.y}px)`;
    return true;
  }

  draw(container: HTMLElement, frame: GlyphCatalogFrame, state: GlyphCatalogOverlayState): void {
    const {
      hoveredPreviewIndex,
      hoveredNameIndex,
      selection,
      selectionBox,
      editingGlyphId,
      emptyGlyphIds,
    } = state;
    const context = Canvas2DSurface.from(this.#canvas).ctx;
    const style = getComputedStyle(container);
    const mutedColor = style.getPropertyValue("--color-muted").trim() || style.color;
    const token = (name: string) => style.getPropertyValue(name).trim() || style.color;
    const tileColor = token("--color-tile");
    const bandColor = token("--color-tile-band");
    const hoverColor = token("--color-hover");
    const inkColor = token("--color-tile-ink");
    const primaryColor = token("--color-primary");
    const accentColor = style.getPropertyValue("--color-accent").trim() || style.color;
    const fontFamily = style.fontFamily;
    context.clearRect(0, 0, frame.layout.viewportWidth, frame.layout.viewportHeight);

    for (const cell of frame.cells) {
      const box = cell.cellRect;
      const band = nameBandRect(cell);
      const { markColor } = cell.glyph;
      const tagColor = markColor ? resolvedMarkColor(markColor, style) : null;
      const selected = selection.has(cell.glyph.id);
      // A selected cell keeps the hover fill, so it stays marked once the pointer leaves.
      const shaded = cell.catalogIndex === hoveredPreviewIndex || selected;

      // The cell is grey, a shade darker while hovered or selected.
      context.save();
      context.beginPath();
      context.roundRect(box.x, box.y, box.width, box.height, CELL_RADIUS);
      context.fillStyle = shaded ? hoverColor : tileColor;
      context.fill();
      context.clip();

      // The name sits on a band across the cell's foot: a tagged cell's in its colour, an
      // untagged one's a shade off the tile.
      context.fillStyle = tagColor ?? bandColor;
      context.fillRect(band.x, band.y, band.width, band.height);
      if (cell.catalogIndex === hoveredNameIndex) {
        context.fillStyle = inkColor;
        context.globalAlpha = BAND_HOVER_ALPHA;
        context.fillRect(band.x, band.y, band.width, band.height);
        context.globalAlpha = 1;
      }
      context.restore();

      // The ring sits on the cell's own edge, so it never reaches into the gap.
      if (selected) {
        const inset = SELECTION_RING_WIDTH / 2;
        context.strokeStyle = accentColor;
        context.lineWidth = SELECTION_RING_WIDTH;
        context.beginPath();
        context.roundRect(
          box.x + inset,
          box.y + inset,
          box.width - 2 * inset,
          box.height - 2 * inset,
          CELL_RADIUS - inset,
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

      // The input shows the name of the glyph being renamed.
      if (cell.glyph.id === editingGlyphId) continue;

      // On a band the name reads in the primary text colour.
      context.fillStyle = tagColor ? primaryColor : mutedColor;
      context.font = `400 10px ${fontFamily}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        fitCanvasText(context, cell.glyph.displayName, band.width - 2 * LABEL_HORIZONTAL_INSET),
        band.x + band.width / 2,
        band.y + band.height / 2,
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

/** The band across a cell's foot that holds its name. */
function nameBandRect(cell: GlyphCatalogCell): Rect2D {
  const name = cell.nameRect;
  return Rect.fromXYWH(name.x, name.y, name.width, cell.cellRect.bottom - name.y);
}

/** Where the rename field sits: inside the name band. */
function nameFieldRect(cell: GlyphCatalogCell): Rect2D {
  const band = nameBandRect(cell);
  return Rect.fromXYWH(
    band.x + NAME_FIELD_INSET_X,
    band.y + (band.height - NAME_FIELD_HEIGHT) / 2,
    band.width - 2 * NAME_FIELD_INSET_X,
    NAME_FIELD_HEIGHT,
  );
}
