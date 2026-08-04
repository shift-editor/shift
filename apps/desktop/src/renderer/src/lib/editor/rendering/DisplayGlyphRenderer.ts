import type { Point2D } from "@shift/geo";
import type { GlyphGuideMetrics, GlyphRenderInput } from "@/types/glyphRender";
import type { RenderContext } from "@/types/rendering";
import { OutlineRenderer } from "./Outline";
import { Anchors, ControlLines, Guides, Handles } from "./overlays";

/** Draws retained selected glyphs through the existing authored glyph primitives. */
export class DisplayGlyphRenderer {
  readonly #outline = new OutlineRenderer();
  readonly #controlLines = new ControlLines();
  readonly #handles = new Handles();
  readonly #anchors = new Anchors();
  readonly #guides = new Guides();

  drawBackground(ctx: RenderContext, glyph: GlyphRenderInput, metrics: GlyphGuideMetrics): void {
    this.#guides.draw(ctx.canvas, metrics, glyph.xAdvance);
  }

  drawScene(ctx: RenderContext, glyph: GlyphRenderInput, drawOffset: Point2D): void {
    this.#outline.draw(ctx.canvas, glyph, {
      fill: null,
      stroke: {
        color: ctx.canvas.theme.glyph.stroke,
        widthPx: ctx.canvas.theme.glyph.widthPx,
      },
    });

    const rootContours = glyph.contours
      .filter((contour) => contour.root)
      .map((contour) => contour.contour);
    this.#controlLines.draw(ctx.canvas, rootContours);
    this.#handles.drawShapes(ctx, rootContours, drawOffset);
    this.#anchors.drawShapes(ctx.canvas, glyph.anchors);
  }
}
