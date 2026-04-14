import type { Point2D } from "@shift/types";
import type { Canvas } from "../Canvas";
import type { SnapIndicator } from "../../snapping/types";

interface SnapLine {
  from: Point2D;
  to: Point2D;
}

export class SnapLines {
  draw(canvas: Canvas, indicator: SnapIndicator): void {
    const { color, widthPx, crossSizePx } = canvas.theme.snap;
    const crossHalf = canvas.pxToUpm(crossSizePx);

    // Draw snap alignment lines
    for (const line of indicator.lines) {
      canvas.line(line.from, line.to, color, widthPx);
    }

    // Draw cross markers at endpoints
    const markers = indicator.markers ?? collectEndpoints(indicator.lines);
    for (const m of markers) {
      canvas.line(
        { x: m.x - crossHalf, y: m.y - crossHalf },
        { x: m.x + crossHalf, y: m.y + crossHalf },
        color,
        widthPx,
      );
      canvas.line(
        { x: m.x - crossHalf, y: m.y + crossHalf },
        { x: m.x + crossHalf, y: m.y - crossHalf },
        color,
        widthPx,
      );
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
