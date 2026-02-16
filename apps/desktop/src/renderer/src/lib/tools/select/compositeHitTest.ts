import type { Point2D } from "@shift/types";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";

export function resolveComponentAtPoint(
  composite: CompositeComponentsPayload | null,
  localPoint: Point2D,
): { index: number; component: CompositeComponentsPayload["components"][number] } | null {
  if (!composite) return null;

  for (let i = 0; i < composite.components.length; i++) {
    const component = composite.components[i];
    if (isPointInComponentBounds(component.contours, localPoint)) {
      return { index: i, component };
    }
  }

  return null;
}

export function isPointInComponentBounds(
  contours: CompositeComponentsPayload["components"][number]["contours"],
  point: Point2D,
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasPoint = false;

  for (const contour of contours) {
    for (const p of contour.points) {
      hasPoint = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!hasPoint) return false;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}
