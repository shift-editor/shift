import chroma from "chroma-js";
import { HandleType } from "../../types/handle";
import { IRenderer } from "../../types/renderer";
import { Path } from "../core/Path";
import { StrokeStyle } from "../graphics/styles/style";
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
  console.log(segments);

  const firstSegment = segments[0];
  ctx.moveTo(firstSegment.anchor.x, firstSegment.anchor.y);
  if (segments.length === 0) {
    return;
  }

  const firstPoint = segments[0].anchor;
  ctx.moveTo(firstPoint.x, firstPoint.y);

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    ctx.lineTo(segment.anchor.x, segment.anchor.y);
  }

  if (path.closed) {
    ctx.close();
    // Fill closed paths
    ctx.drawPath({
      strokeStyle: StrokeStyle.Fill,
      strokeColour: chroma.rgb(0, 0, 0, 0.2), // Semi-transparent fill
    });
  } else {
    // Just stroke for open paths
    ctx.drawPath({
      strokeStyle: StrokeStyle.Stroke,
    });
  }

  drawHandles(ctx, path);
  ctx.restore();
};

const drawHandles = (ctx: IRenderer, path: Path) => {
  for (const segment of path.segments()) {
    const h = new Handle(segment.anchor, HandleType.CORNER);
    h.draw(ctx);
  }
};
