import type { Rect2D } from "@shift/geo";
import { Point, type NewPoint } from "@shift/glyph-state";
import type { Shape } from "./types";

export class Rectangle implements Shape {
  readonly label = "rectangle";

  createPoints(bounds: Rect2D): readonly NewPoint[] {
    const { x, y, width, height } = bounds;

    return [
      Point.onCurve({ x, y }),
      Point.onCurve({ x: x + width, y }),
      Point.onCurve({ x: x + width, y: y + height }),
      Point.onCurve({ x, y: y + height }),
    ];
  }
}
