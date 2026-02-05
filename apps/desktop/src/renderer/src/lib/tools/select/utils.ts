import type { Point2D, PointId, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../core/ToolContext";

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
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

export function cacheSelectedPositions(editor: ToolContext): Map<PointId, Point2D> {
  const positions = new Map<PointId, Point2D>();
  for (const p of editor.getAllPoints()) {
    if (editor.isPointSelected(p.id as PointId)) {
      positions.set(p.id as PointId, { x: p.x, y: p.y });
    }
  }
  return positions;
}
