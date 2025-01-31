import { HandleType } from "../../types/handle";
import { IRenderer } from "../../types/graphics";
import { Path } from "../core/Path";
import { Handle } from "./Handle";

export const drawPath = (ctx: IRenderer, path: Path) => {
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
    ctx.close();
    ctx.drawPath();
  }

  drawHandles(ctx, path);
};

const drawHandles = (ctx: IRenderer, path: Path) => {
  for (const segment of path.segments()) {
    const h = new Handle(segment.anchor, HandleType.CORNER);
    h.draw(ctx);
  }
};
