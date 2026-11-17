import { Rect, type Point2D, type Rect2D } from "@shift/geo";
import { TILE_SIZE } from "@/lib/glyph-grid/GlyphGridView";
import type {
  GlyphCatalogCell,
  GlyphCatalogCellArea,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GlyphCatalogLayoutMetrics,
} from "@/types/glyphCatalog";

const COLUMN_GAP = 8;

/**
 * How much room a catalog gives its tiles: `regular` is the font overview,
 * with margins and a name under each preview; `compact` fits a sidebar, with
 * small margins and the preview alone.
 */
export type CatalogDensity = "regular" | "compact";

/** The spacing each density uses, in CSS pixels. */
const SPACING: Record<
  CatalogDensity,
  {
    readonly viewportPadding: number;
    readonly gridInset: number;
    readonly rowGap: number;
    readonly nameGap: number;
    readonly nameHeight: number;
  }
> = {
  regular: { viewportPadding: 20, gridInset: 16, rowGap: 12, nameGap: 8, nameHeight: 28 },
  compact: { viewportPadding: 8, gridInset: 0, rowGap: 8, nameGap: 0, nameHeight: 0 },
};
/** A tile's preview height and the inset of the glyph inside it, as fractions of its width. */
const PREVIEW_HEIGHT_RATIO = 0.75;
const PREVIEW_INSET_RATIO = 0.16;

/** Immutable screen-space layout for one glyph catalog viewport. */
export class GlyphCatalogLayout implements GlyphCatalogLayoutMetrics {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly glyphCount: number;
  readonly columns: number;
  readonly rowCount: number;
  readonly cellWidth: number;
  readonly totalHeight: number;
  readonly viewportPadding: number;
  readonly gridInset: number;
  readonly gridLeft: number;
  readonly gridWidth: number;
  readonly columnGap = COLUMN_GAP;
  readonly rowPitch: number;
  readonly previewHeight: number;
  readonly previewContentInset: number;
  readonly nameGap: number;
  readonly nameHeight: number;
  /** A tile's height: its preview, the gap and its name. */
  readonly cellHeight: number;

  /**
   * @param tileSize - the width tiles are given before a row is stretched to
   * fill, within {@link TILE_SIZE}; previews keep their proportions.
   * @param density - the margins and whether tiles carry a name.
   */
  constructor(
    viewportWidth: number,
    viewportHeight: number,
    glyphCount: number,
    tileSize: number = TILE_SIZE.default,
    density: CatalogDensity = "regular",
  ) {
    const spacing = SPACING[density];
    this.viewportPadding = spacing.viewportPadding;
    this.gridInset = spacing.gridInset;
    this.gridLeft = spacing.viewportPadding + spacing.gridInset;
    this.nameGap = spacing.nameGap;
    this.nameHeight = spacing.nameHeight;
    const nominalCellWidth = clamp(Math.round(tileSize), TILE_SIZE.min, TILE_SIZE.max);
    this.previewHeight = Math.round(nominalCellWidth * PREVIEW_HEIGHT_RATIO);
    this.previewContentInset = Math.round(nominalCellWidth * PREVIEW_INSET_RATIO);
    this.cellHeight = this.previewHeight + spacing.nameGap + spacing.nameHeight;
    this.rowPitch = this.cellHeight + spacing.rowGap;
    this.viewportWidth = finiteNonNegative(viewportWidth);
    this.viewportHeight = finiteNonNegative(viewportHeight);
    this.glyphCount = Math.max(0, Math.floor(finiteNonNegative(glyphCount)));
    this.gridWidth = Math.max(0, this.viewportWidth - 2 * this.gridLeft);
    this.columns =
      this.gridWidth > 0
        ? Math.max(1, Math.floor((this.gridWidth + COLUMN_GAP) / (nominalCellWidth + COLUMN_GAP)))
        : 0;
    if (this.columns === 0) {
      this.cellWidth = 0;
    } else if (this.glyphCount < this.columns) {
      this.cellWidth = nominalCellWidth;
    } else {
      this.cellWidth = (this.gridWidth - Math.max(0, this.columns - 1) * COLUMN_GAP) / this.columns;
    }

    this.rowCount = this.columns > 0 ? Math.ceil(this.glyphCount / this.columns) : 0;
    this.totalHeight =
      this.rowCount > 0 ? 2 * this.viewportPadding + this.rowCount * this.rowPitch : 0;
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
          cellRect: Rect.fromXYWH(x, y, this.cellWidth, this.cellHeight),
          previewRect,
          previewContentRect,
          nameRect,
        });
      }
    }

    return { layout: this, scrollTop: boundedScrollTop, cells };
  }

  /**
   * Returns the scroll offset that brings a glyph's whole cell into view, the
   * least distance from `scrollTop`.
   *
   * @returns null when the cell is already fully visible or the index is out of range.
   */
  scrollTopToReveal(catalogIndex: number, scrollTop: number): number | null {
    if (this.columns === 0 || catalogIndex < 0 || catalogIndex >= this.glyphCount) return null;

    const top = this.viewportPadding + Math.floor(catalogIndex / this.columns) * this.rowPitch;
    const bottom = top + this.cellHeight;
    if (top < scrollTop) return Math.max(0, top - this.viewportPadding);
    if (bottom > scrollTop + this.viewportHeight) {
      return bottom - this.viewportHeight + this.viewportPadding;
    }
    return null;
  }

  /**
   * The catalog index of the glyph whose preview or name holds `point`, a
   * point in the scrolled content rather than the viewport, or null in a gap.
   */
  indexAt(point: Point2D, area: GlyphCatalogCellArea = "preview"): number | null {
    const pitch = this.cellWidth + this.columnGap;
    if (this.columns === 0 || pitch <= 0) return null;

    const column = Math.floor((point.x - this.gridLeft) / pitch);
    const row = Math.floor((point.y - this.viewportPadding) / this.rowPitch);
    const index = row * this.columns + column;
    if (column < 0 || column >= this.columns || row < 0 || index >= this.glyphCount) return null;

    const x = point.x - this.gridLeft - column * pitch;
    const y = point.y - this.viewportPadding - row * this.rowPitch;
    const nameTop = this.previewHeight + this.nameGap;
    const inArea =
      area === "preview" ? y < this.previewHeight : y >= nameTop && y < nameTop + this.nameHeight;
    return x < this.cellWidth && inArea ? index : null;
  }

  /**
   * The catalog indices of the glyphs whose cells `box` touches, in grid
   * order; `box` is in the scrolled content, so it may reach past the viewport.
   */
  indicesIn(box: Rect2D): number[] {
    const pitch = this.cellWidth + this.columnGap;
    if (this.columns === 0 || pitch <= 0) return [];

    const firstColumn = Math.max(0, Math.ceil((box.left - this.gridLeft - this.cellWidth) / pitch));
    const lastColumn = Math.min(this.columns - 1, Math.floor((box.right - this.gridLeft) / pitch));
    const top = box.top - this.viewportPadding;
    const firstRow = Math.max(0, Math.ceil((top - this.cellHeight) / this.rowPitch));
    const lastRow = Math.min(
      this.rowCount - 1,
      Math.floor((box.bottom - this.viewportPadding) / this.rowPitch),
    );
    const indices: number[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const index = row * this.columns + column;
        if (index < this.glyphCount) indices.push(index);
      }
    }
    return indices;
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
