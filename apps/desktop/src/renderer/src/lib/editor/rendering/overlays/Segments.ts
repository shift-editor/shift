import type { Canvas } from "../Canvas";
import type { Segment, SegmentId } from "@shift/glyph-state";
import type { GlyphInstanceGeometry } from "@/lib/model/Glyph";

export class Segments {
  readonly #selected: Segment[] = [];

  draw(
    canvas: Canvas,
    geometry: GlyphInstanceGeometry,
    selectedSegmentIds: readonly SegmentId[],
    hoveredSegmentId: SegmentId | null,
  ): void {
    this.#selected.length = 0;

    for (const segmentId of selectedSegmentIds) {
      const segment = geometry.segment(segmentId);
      if (segment) this.#selected.push(segment);
    }

    this.#drawResolved(
      canvas,
      hoveredSegmentId ? geometry.segment(hoveredSegmentId) : null,
      this.#selected,
    );
  }

  #drawResolved(canvas: Canvas, hovered: Segment | null, selected: readonly Segment[]): void {
    if (!hovered && selected.length === 0) return;

    const theme = canvas.theme.segment;

    if (selected.length > 0) {
      const lw = canvas.pxToUpm(theme.selectedWidthPx);
      canvas.ctx.save();
      canvas.ctx.strokeStyle = theme.selectedColor;
      canvas.ctx.lineWidth = lw;
      canvas.ctx.setLineDash([]);
      canvas.ctx.beginPath();
      for (const seg of selected) {
        appendSegmentCurve(canvas.ctx, seg);
      }
      canvas.ctx.stroke();
      canvas.ctx.restore();
    }

    if (hovered && !selected.some((s) => s.id === hovered.id)) {
      const lw = canvas.pxToUpm(theme.hoverWidthPx);
      canvas.ctx.save();
      canvas.ctx.strokeStyle = theme.hoverColor;
      canvas.ctx.lineWidth = lw;
      canvas.ctx.setLineDash([]);
      canvas.ctx.beginPath();
      appendSegmentCurve(canvas.ctx, hovered);
      canvas.ctx.stroke();
      canvas.ctx.restore();
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
