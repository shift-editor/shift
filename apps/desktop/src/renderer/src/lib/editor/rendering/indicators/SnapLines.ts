import type { Canvas } from "../Canvas";
import type { SnapIndicator } from "../../snapping/types";

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

function collectEndpoints(
  lines: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number } }>,
): Array<{ x: number; y: number }> {
  const markers: Array<{ x: number; y: number }> = [];
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
