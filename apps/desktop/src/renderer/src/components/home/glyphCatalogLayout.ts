import type { Point2D, Rect2D } from "@shift/geo";
import type {
  GlyphCatalogCell,
  GlyphCatalogCellArea,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GlyphCatalogLayout,
} from "@/types/glyphCatalog";

const VIEWPORT_PADDING = 20;
const GRID_INSET = 16;
const COLUMN_GAP = 8;
const NOMINAL_CELL_WIDTH = 100;
const ROW_PITCH = 123;
const PREVIEW_HEIGHT = 75;
const PREVIEW_CONTENT_INSET = 16;
const NAME_GAP = 8;
const NAME_HEIGHT = 28;
const CELL_HEIGHT = PREVIEW_HEIGHT + NAME_GAP + NAME_HEIGHT;

export function deriveGlyphCatalogLayout(
  viewportWidth: number,
  viewportHeight: number,
  glyphCount: number,
): GlyphCatalogLayout {
  const safeViewportWidth = finiteNonNegative(viewportWidth);
  const safeViewportHeight = finiteNonNegative(viewportHeight);
  const safeGlyphCount = Math.max(0, Math.floor(finiteNonNegative(glyphCount)));
  const gridLeft = VIEWPORT_PADDING + GRID_INSET;
  const gridWidth = Math.max(0, safeViewportWidth - 2 * gridLeft);
  const columns =
    gridWidth > 0
      ? Math.max(1, Math.floor((gridWidth + COLUMN_GAP) / (NOMINAL_CELL_WIDTH + COLUMN_GAP)))
      : 0;
  const cellWidth = columns > 0 ? (gridWidth - Math.max(0, columns - 1) * COLUMN_GAP) / columns : 0;
  const rowCount = columns > 0 ? Math.ceil(safeGlyphCount / columns) : 0;
  const totalHeight = rowCount > 0 ? 2 * VIEWPORT_PADDING + rowCount * ROW_PITCH : 0;

  return {
    viewportWidth: safeViewportWidth,
    viewportHeight: safeViewportHeight,
    glyphCount: safeGlyphCount,
    columns,
    rowCount,
    cellWidth,
    totalHeight,
    viewportPadding: VIEWPORT_PADDING,
    gridInset: GRID_INSET,
    gridLeft,
    gridWidth,
    columnGap: COLUMN_GAP,
    rowPitch: ROW_PITCH,
    previewHeight: PREVIEW_HEIGHT,
    previewContentInset: PREVIEW_CONTENT_INSET,
    nameGap: NAME_GAP,
    nameHeight: NAME_HEIGHT,
  };
}

export function deriveVisibleGlyphCatalogCells(
  layout: GlyphCatalogLayout,
  glyphs: readonly GlyphCatalogItem[],
  scrollTop: number,
): GlyphCatalogFrame {
  const maximumScrollTop = Math.max(0, layout.totalHeight - layout.viewportHeight);
  const boundedScrollTop = Math.min(maximumScrollTop, finiteNonNegative(scrollTop));
  const glyphCount = Math.min(layout.glyphCount, glyphs.length);

  if (
    glyphCount === 0 ||
    layout.columns === 0 ||
    layout.rowCount === 0 ||
    layout.viewportHeight <= 0
  ) {
    return { layout, scrollTop: boundedScrollTop, cells: [] };
  }

  const firstRow = clamp(
    Math.floor((boundedScrollTop - layout.viewportPadding) / layout.rowPitch),
    0,
    layout.rowCount - 1,
  );
  const lastRow = clamp(
    Math.ceil(
      (boundedScrollTop + layout.viewportHeight - layout.viewportPadding) / layout.rowPitch,
    ) - 1,
    firstRow,
    layout.rowCount - 1,
  );
  const cells: GlyphCatalogCell[] = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowStartIndex = row * layout.columns;
    const rowEndIndex = Math.min(glyphCount, rowStartIndex + layout.columns);

    for (let catalogIndex = rowStartIndex; catalogIndex < rowEndIndex; catalogIndex += 1) {
      const glyph = glyphs[catalogIndex];
      if (!glyph) continue;

      const column = catalogIndex - rowStartIndex;
      const x = layout.gridLeft + column * (layout.cellWidth + layout.columnGap);
      const y = layout.viewportPadding + row * layout.rowPitch - boundedScrollTop;
      const previewRect = rect(x, y, layout.cellWidth, layout.previewHeight);
      const previewContentRect = rect(
        x + layout.previewContentInset,
        y,
        Math.max(0, layout.cellWidth - 2 * layout.previewContentInset),
        layout.previewHeight,
      );
      const nameRect = rect(
        x,
        y + layout.previewHeight + layout.nameGap,
        layout.cellWidth,
        layout.nameHeight,
      );

      cells.push({
        catalogIndex,
        glyph,
        cellRect: rect(x, y, layout.cellWidth, CELL_HEIGHT),
        previewRect,
        previewContentRect,
        nameRect,
      });
    }
  }

  return { layout, scrollTop: boundedScrollTop, cells };
}

export function hitGlyphCatalogCell(
  frame: GlyphCatalogFrame,
  point: Point2D,
  area: GlyphCatalogCellArea = "preview",
): GlyphCatalogCell | null {
  for (const cell of frame.cells) {
    switch (area) {
      case "preview":
        if (contains(cell.previewRect, point)) return cell;
        break;
      case "name":
        if (contains(cell.nameRect, point)) return cell;
        break;
    }
  }

  return null;
}

function rect(x: number, y: number, width: number, height: number): Rect2D {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function contains(rectangle: Rect2D, point: Point2D): boolean {
  return (
    point.x >= rectangle.left &&
    point.x < rectangle.right &&
    point.y >= rectangle.top &&
    point.y < rectangle.bottom
  );
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
