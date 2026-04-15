import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { Canvas } from "../Canvas";
import type { SnapIndicator, SnapLine } from "../../snapping/types";

export class SnapLines {
  draw(canvas: Canvas, indicator: SnapIndicator): void {
    const { color, widthPx, crossSizePx } = canvas.theme.snap;
    const crossHalf = canvas.pxToUpm(crossSizePx);

    for (const line of indicator.lines) {
      canvas.line(line.from, line.to, color, widthPx);
    }

    const markers = indicator.markers ?? collectEndpoints(indicator.lines);
    const diagonal: Point2D = { x: crossHalf, y: crossHalf };
    const antiDiagonal: Point2D = { x: crossHalf, y: -crossHalf };

    for (const m of markers) {
      canvas.line(Vec2.sub(m, diagonal), Vec2.add(m, diagonal), color, widthPx);
      canvas.line(Vec2.sub(m, antiDiagonal), Vec2.add(m, antiDiagonal), color, widthPx);
    }
  }
}

function collectEndpoints(lines: ReadonlyArray<SnapLine>): Point2D[] {
  const markers: Point2D[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const endpoint of [line.from, line.to]) {
      const key = `${endpoint.x}:${endpoint.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push(endpoint);
    }
  }
  return markers;
}
