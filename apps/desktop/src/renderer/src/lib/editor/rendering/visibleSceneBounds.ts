import type { ViewportTransform } from "./CanvasCoordinator";

export type VisibleSceneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function getVisibleSceneBounds(
  viewport: ViewportTransform,
  cullMarginPx: number,
): VisibleSceneBounds {
  const logicalWidth = viewport.centre.x * 2;
  const viewTranslateX = viewport.panX + viewport.centre.x * (1 - viewport.zoom);
  const viewTranslateY = viewport.panY + viewport.centre.y * (1 - viewport.zoom);
  const baselineY =
    viewport.logicalHeight - viewport.padding - viewport.descender * viewport.upmScale;
  const zoomedScale = viewport.upmScale * viewport.zoom;
  const minScreenX = -cullMarginPx;
  const maxScreenX = logicalWidth + cullMarginPx;
  const minScreenY = -cullMarginPx;
  const maxScreenY = viewport.logicalHeight + cullMarginPx;

  const minX = (minScreenX - viewTranslateX - viewport.padding * viewport.zoom) / zoomedScale;
  const maxX = (maxScreenX - viewTranslateX - viewport.padding * viewport.zoom) / zoomedScale;
  const maxY = (baselineY * viewport.zoom + viewTranslateY - minScreenY) / zoomedScale;
  const minY = (baselineY * viewport.zoom + viewTranslateY - maxScreenY) / zoomedScale;

  return { minX, maxX, minY, maxY };
}
