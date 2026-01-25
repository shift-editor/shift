import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { AnchorPosition } from "@/components/sidebar/TransformGrid";

/**
 * Maps a 9-grid anchor position to an actual point on a bounding rectangle.
 *
 * Anchor positions:
 * - tl (top-left), tm (top-middle), tr (top-right)
 * - lm (left-middle), m (center), rm (right-middle)
 * - bl (bottom-left), bm (bottom-middle), br (bottom-right)
 */
export function anchorToPoint(anchor: AnchorPosition, bounds: Rect2D): Point2D {
  const center = Vec2.midpoint({ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.bottom });

  switch (anchor) {
    case "tl":
      return { x: bounds.left, y: bounds.top };
    case "tm":
      return { x: center.x, y: bounds.top };
    case "tr":
      return { x: bounds.right, y: bounds.top };
    case "lm":
      return { x: bounds.left, y: center.y };
    case "m":
      return { x: center.x, y: center.y };
    case "rm":
      return { x: bounds.right, y: center.y };
    case "bl":
      return { x: bounds.left, y: bounds.bottom };
    case "bm":
      return { x: center.x, y: bounds.bottom };
    case "br":
      return { x: bounds.right, y: bounds.bottom };
  }
}
