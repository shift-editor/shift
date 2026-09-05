import type { Rect2D } from "@shift/geo";
import { Point, type NewPoint } from "@shift/glyph-state";
import type { Shape } from "./types";

export class Ellipse implements Shape {
  readonly label = "ellipse";

  createPoints(bounds: Rect2D): readonly NewPoint[] {
    const rx = bounds.width / 2;
    const ry = bounds.height / 2;
    const cx = bounds.x + rx;
    const cy = bounds.y + ry;
    const kappa = (4 / 3) * Math.tan(Math.PI / 8);
    const dx = kappa * rx;
    const dy = kappa * ry;

    return [
      Point.smooth({ x: cx + rx, y: cy }),
      Point.offCurve({ x: cx + rx, y: cy + dy }),
      Point.offCurve({ x: cx + dx, y: cy + ry }),
      Point.smooth({ x: cx, y: cy + ry }),
      Point.offCurve({ x: cx - dx, y: cy + ry }),
      Point.offCurve({ x: cx - rx, y: cy + dy }),
      Point.smooth({ x: cx - rx, y: cy }),
      Point.offCurve({ x: cx - rx, y: cy - dy }),
      Point.offCurve({ x: cx - dx, y: cy - ry }),
      Point.smooth({ x: cx, y: cy - ry }),
      Point.offCurve({ x: cx + dx, y: cy - ry }),
      Point.offCurve({ x: cx + rx, y: cy - dy }),
    ];
  }
}
