import { Rect, type Point2D } from "@shift/geo";
import type { SlugPreviewExtents, SourceMetrics } from "@shift/types";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import type {
  GlyphCatalogCell,
  GlyphCatalogCellArea,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GlyphCatalogLayoutMetrics,
} from "@/types/glyphCatalog";

const VIEWPORT_PADDING = 20;
const GRID_INSET = 16;
const COLUMN_GAP = 8;
const NOMINAL_CELL_WIDTH = 100;
const PREVIEW_HEIGHT = 75;
const PREVIEW_CONTENT_INSET = 16;
const NAME_GAP = 8;
const NAME_HEIGHT = 28;
const ROW_GAP = 12;

/** Immutable screen-space layout for one glyph catalog viewport. */
export class GlyphCatalogLayout implements GlyphCatalogLayoutMetrics {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly glyphCount: number;
  readonly columns: number;
  readonly rowCount: number;
  readonly cellWidth: number;
  readonly totalHeight: number;
  readonly viewportPadding = VIEWPORT_PADDING;
  readonly gridInset = GRID_INSET;
  readonly gridLeft = VIEWPORT_PADDING + GRID_INSET;
  readonly gridWidth: number;
  readonly columnGap = COLUMN_GAP;
  readonly rowPitch: number;
  readonly previewHeight: number;
  readonly previewContentInset = PREVIEW_CONTENT_INSET;
  readonly nameGap = NAME_GAP;
  readonly nameHeight = NAME_HEIGHT;

  constructor(
    viewportWidth: number,
    viewportHeight: number,
    glyphCount: number,
    metrics: SourceMetrics,
    previewExtents: SlugPreviewExtents,
  ) {
    this.viewportWidth = finiteNonNegative(viewportWidth);
    this.viewportHeight = finiteNonNegative(viewportHeight);
    this.glyphCount = Math.max(0, Math.floor(finiteNonNegative(glyphCount)));

    const [baseViewHeight] = GlyphPreviewLayout.fontViewport(metrics);
    const [expandedViewHeight] = GlyphPreviewLayout.fontViewport(metrics, previewExtents);
    const pixelsPerEm = PREVIEW_HEIGHT / Math.max(1, baseViewHeight);
    this.previewHeight = expandedViewHeight * pixelsPerEm;
    this.rowPitch = this.previewHeight + NAME_GAP + NAME_HEIGHT + ROW_GAP;

    const horizontalOverflow = 2 * previewExtents.horizontal * pixelsPerEm;
    const nominalCellWidth = NOMINAL_CELL_WIDTH + horizontalOverflow;
    this.gridWidth = Math.max(0, this.viewportWidth - 2 * this.gridLeft);
    this.columns =
      this.gridWidth > 0
        ? Math.max(1, Math.floor((this.gridWidth + COLUMN_GAP) / (nominalCellWidth + COLUMN_GAP)))
        : 0;
    this.cellWidth =
      this.columns > 0
        ? (this.gridWidth - Math.max(0, this.columns - 1) * COLUMN_GAP) / this.columns
        : 0;
    this.rowCount = this.columns > 0 ? Math.ceil(this.glyphCount / this.columns) : 0;
    this.totalHeight = this.rowCount > 0 ? 2 * VIEWPORT_PADDING + this.rowCount * this.rowPitch : 0;
  }

  /** Derives only the cells intersecting the current native scroll viewport. */
  frame(glyphs: readonly GlyphCatalogItem[], scrollTop: number): GlyphCatalogFrame {
    const maximumScrollTop = Math.max(0, this.totalHeight - this.viewportHeight);
    const boundedScrollTop = Math.min(maximumScrollTop, finiteNonNegative(scrollTop));
    const glyphCount = Math.min(this.glyphCount, glyphs.length);

    if (glyphCount === 0 || this.columns === 0 || this.rowCount === 0 || this.viewportHeight <= 0) {
      return { layout: this, scrollTop: boundedScrollTop, cells: [] };
    }

    const firstRow = clamp(
      Math.floor((boundedScrollTop - this.viewportPadding) / this.rowPitch),
      0,
      this.rowCount - 1,
    );
    const lastRow = clamp(
      Math.ceil((boundedScrollTop + this.viewportHeight - this.viewportPadding) / this.rowPitch) -
        1,
      firstRow,
      this.rowCount - 1,
    );
    const cells: GlyphCatalogCell[] = [];

    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowStartIndex = row * this.columns;
      const rowEndIndex = Math.min(glyphCount, rowStartIndex + this.columns);

      for (let catalogIndex = rowStartIndex; catalogIndex < rowEndIndex; catalogIndex += 1) {
        const glyph = glyphs[catalogIndex];
        if (!glyph) continue;

        const column = catalogIndex - rowStartIndex;
        const x = this.gridLeft + column * (this.cellWidth + this.columnGap);
        const y = this.viewportPadding + row * this.rowPitch - boundedScrollTop;
        const previewRect = Rect.fromXYWH(x, y, this.cellWidth, this.previewHeight);
        const previewContentRect = Rect.fromXYWH(
          x + this.previewContentInset,
          y,
          Math.max(0, this.cellWidth - 2 * this.previewContentInset),
          this.previewHeight,
        );
        const nameRect = Rect.fromXYWH(
          x,
          y + this.previewHeight + this.nameGap,
          this.cellWidth,
          this.nameHeight,
        );

        cells.push({
          catalogIndex,
          glyph,
          cellRect: Rect.fromXYWH(
            x,
            y,
            this.cellWidth,
            this.previewHeight + this.nameGap + this.nameHeight,
          ),
          previewRect,
          previewContentRect,
          nameRect,
        });
      }
    }

    return { layout: this, scrollTop: boundedScrollTop, cells };
  }

  /** Finds the first visible cell containing `point` in the requested area. */
  hit(
    frame: GlyphCatalogFrame,
    point: Point2D,
    area: GlyphCatalogCellArea = "preview",
  ): GlyphCatalogCell | null {
    for (const cell of frame.cells) {
      switch (area) {
        case "preview":
          if (Rect.containsPoint(cell.previewRect, point)) return cell;
          break;
        case "name":
          if (Rect.containsPoint(cell.nameRect, point)) return cell;
          break;
      }
    }

    return null;
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
