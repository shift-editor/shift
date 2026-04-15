import type { Canvas } from "../Canvas";
import type { Segment as SegmentType } from "@/types/segments";
import { Segment } from "@/lib/geo/Segment";

export class Segments {
  draw(canvas: Canvas, hovered: SegmentType | null, selected: readonly SegmentType[]): void {
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

    if (hovered && !selected.some((s) => Segment.id(s) === Segment.id(hovered))) {
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

function appendSegmentCurve(ctx: CanvasRenderingContext2D, segment: SegmentType): void {
  const curve = Segment.toCurve(segment);
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
