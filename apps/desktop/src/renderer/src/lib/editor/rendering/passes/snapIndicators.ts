import type { IRenderer } from "@/types/graphics";
import type { SnapIndicator } from "../../snapping/types";
import { SNAP_INDICATOR_STYLE } from "@/lib/styles/style";
import type { RenderContext } from "./types";

export function renderSnapIndicators(
  rc: RenderContext,
  indicator: SnapIndicator,
  crossHalf: number,
): void {
  rc.ctx.strokeStyle = SNAP_INDICATOR_STYLE.strokeStyle;
  rc.ctx.lineWidth = rc.lineWidthUpm(SNAP_INDICATOR_STYLE.lineWidth);

  for (const line of indicator.lines) {
    rc.ctx.drawLine(line.from.x, line.from.y, line.to.x, line.to.y);
  }

  const markers = indicator.markers ?? collectLineEndpoints(indicator.lines);
  for (const marker of markers) {
    drawX(rc.ctx, marker.x, marker.y, crossHalf);
  }
}

export function collectLineEndpoints(
  lines: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number } }>,
): Array<{ x: number; y: number }> {
  const markers: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const endpoints = [line.from, line.to];
    for (const endpoint of endpoints) {
      const key = `${endpoint.x}:${endpoint.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push(endpoint);
    }
  }
  return markers;
}

function drawX(ctx: IRenderer, x: number, y: number, half: number): void {
  ctx.drawLine(x - half, y - half, x + half, y + half);
  ctx.drawLine(x - half, y + half, x + half, y - half);
}
