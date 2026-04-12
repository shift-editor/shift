import type { Point2D, CompositeGlyph, CompositeComponent, RenderContour } from "@shift/types";
import { Bounds } from "@shift/geo";

export function resolveComponentAtPoint(
  composite: CompositeGlyph | null,
  localPoint: Point2D,
): { index: number; component: CompositeComponent } | null {
  if (!composite) return null;

  for (const [i, component] of composite.components.entries()) {
    if (isPointInComponentBounds(component.contours, localPoint)) {
      return { index: i, component };
    }
  }

  return null;
}

export function isPointInComponentBounds(
  contours: readonly RenderContour[],
  point: Point2D,
): boolean {
  const allPoints = contours.flatMap((c) => c.points);
  const bounds = Bounds.fromPoints(allPoints);
  if (!bounds) return false;

  return Bounds.containsPoint(bounds, point);
}
