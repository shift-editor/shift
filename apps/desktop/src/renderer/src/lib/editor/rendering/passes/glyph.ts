import type { IRenderer } from "@/types/graphics";
import type { Glyph } from "@shift/types";
import { buildContourPath } from "../render";

export function renderGlyphOutline(ctx: IRenderer, glyph: Glyph): boolean {
  let hasClosed = false;

  ctx.beginPath();
  for (const contour of glyph.contours) {
    const isClosed = buildContourPath(ctx, contour);
    if (isClosed) hasClosed = true;
  }
  ctx.stroke();

  return hasClosed;
}

export function renderGlyphFilled(ctx: IRenderer, glyph: Glyph): void {
  ctx.fillStyle = "black";
  ctx.beginPath();
  for (const contour of glyph.contours) {
    buildContourPath(ctx, contour);
  }
  ctx.fill();
}
