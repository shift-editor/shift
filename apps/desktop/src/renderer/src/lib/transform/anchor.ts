import type { Point2D } from "@shift/types";
import { Bounds } from "@shift/geo";
import type { AnchorPosition } from "@/components/sidebar/TransformGrid";

export function anchorToPoint(anchor: AnchorPosition, bounds: Bounds): Point2D {
  const center = Bounds.center(bounds);

  switch (anchor) {
    case "tl":
      return { x: bounds.min.x, y: bounds.min.y };
    case "tm":
      return { x: center.x, y: bounds.min.y };
    case "tr":
      return { x: bounds.max.x, y: bounds.min.y };
    case "lm":
      return { x: bounds.min.x, y: center.y };
    case "m":
      return { x: center.x, y: center.y };
    case "rm":
      return { x: bounds.max.x, y: center.y };
    case "bl":
      return { x: bounds.min.x, y: bounds.max.y };
    case "bm":
      return { x: center.x, y: bounds.max.y };
    case "br":
      return { x: bounds.max.x, y: bounds.max.y };
  }
}
