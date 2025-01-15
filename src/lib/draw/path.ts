import { HandleType } from "../../types/handle";
import { IRenderer } from "../../types/renderer";
import { Path } from "../core/Path";
import { Handle } from "./Handle";

export const drawPath = (ctx: IRenderer, path: Path) => {
  console.log(path.points);
  if (path.points.length == 1) {
    const h = new Handle(path.points[0], HandleType.CORNER);
    h.draw(ctx);
    return;
  }

  ctx.beginPath();
  const segments = path.segments();
  console.log(segments);

  const firstSegment = segments[0];
  ctx.moveTo(firstSegment.start.x, firstSegment.start.y);

  for (const segment of segments) {
    ctx.lineTo(segment.end.x, segment.end.y);
  }

  ctx.stroke();
  ctx.drawPath();
};
