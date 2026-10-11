import type { Canvas } from "../Canvas";
import type { Segment } from "@shift/glyph-state";
import type { SegmentId } from "@shift/types";
import type { GlyphRenderModel } from "../../../model/Glyph";

export class Segments {
  readonly #selected: Segment[] = [];

  draw(
    canvas: Canvas,
    view: GlyphRenderModel,
    selectedSegmentIds: readonly SegmentId[],
    hoveredSegmentId: SegmentId | null,
  ): void {
    this.#selected.length = 0;

    for (const segmentId of selectedSegmentIds) {
      const segment = view.segment(segmentId);
      if (segment) this.#selected.push(segment);
    }

    this.#drawResolved(
      canvas,
      hoveredSegmentId ? view.segment(hoveredSegmentId) : null,
      this.#selected,
    );
  }

  #drawResolved(canvas: Canvas, hovered: Segment | null, selected: readonly Segment[]): void {
    if (!hovered && selected.length === 0) return;

    const theme = canvas.theme.segment;

    if (selected.length > 0) {
      canvas.ctx.beginPath();
      for (const seg of selected) {
        appendSegmentCurve(canvas.ctx, seg);
      }
      canvas.stroke(theme.selectedColor, theme.selectedWidthPx);
    }

    if (hovered && !selected.some((s) => s.id === hovered.id)) {
      canvas.ctx.beginPath();
      appendSegmentCurve(canvas.ctx, hovered);
      canvas.stroke(theme.hoverColor, theme.hoverWidthPx);
    }
  }
}

function appendSegmentCurve(ctx: CanvasRenderingContext2D, segment: Segment): void {
  const curve = segment.toCurve();
  ctx.moveTo(curve.p0.x, curve.p0.y);

  switch (curve.type) {
    case "line":
      ctx.lineTo(curve.p1.x, curve.p1.y);
      break;
    case "quadratic":
      ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.p1.x, curve.p1.y);
      break;
    case "cubic":
      ctx.bezierCurveTo(curve.c0.x, curve.c0.y, curve.c1.x, curve.c1.y, curve.p1.x, curve.p1.y);
      break;
  }
}
