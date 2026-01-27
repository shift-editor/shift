import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";

export function normalizeRect(start: Point2D, current: Point2D): Rect2D {
  const min = Vec2.min(start, current);
  const max = Vec2.max(start, current);
  return {
    x: min.x,
    y: min.y,
    width: max.x - min.x,
    height: max.y - min.y,
    left: min.x,
    top: min.y,
    right: max.x,
    bottom: max.y,
  };
}

export function pointInRect(p: Point2D, rect: Rect2D): boolean {
  return (
    p.x >= rect.left &&
    p.x <= rect.right &&
    p.y >= rect.top &&
    p.y <= rect.bottom
  );
}
