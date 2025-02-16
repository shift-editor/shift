import { Handle } from "./Handle";
import { IRenderer } from "../../types/graphics";
import { HandleType } from "../../types/handle";
import { Contour } from "../core/Contour";

export const drawPath = (ctx: IRenderer, path: Contour) => {
  if (path.points.length == 0) return;
  if (path.points.length == 1) {
    const h = new Handle(path.points[0], HandleType.CORNER);
    h.draw(ctx);
    return;
  }

  ctx.beginPath();
  const segments = path.segments();

  const firstSegment = segments[0];
  ctx.moveTo(firstSegment.anchor.x, firstSegment.anchor.y);

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    ctx.lineTo(segment.anchor.x, segment.anchor.y);
  }

  if (path.closed) {
    ctx.closePath();
  }

  drawHandles(ctx, path);
};

const drawHandles = (ctx: IRenderer, path: Contour) => {
  for (const segment of path.segments()) {
    const h = new Handle(segment.anchor, HandleType.CORNER);
    h.draw(ctx);
  }
};
