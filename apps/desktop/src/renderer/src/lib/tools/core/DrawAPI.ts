import type { Point2D } from "@shift/types";
import type { IRenderer } from "@/types/graphics";

export interface StrokeStyle {
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  lineCap?: "butt" | "round" | "square";
}

export interface ShapeStyle extends StrokeStyle {
  fill?: string;
}

export interface HandleStyle {
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface DrawAPI {
  line(from: Point2D, to: Point2D, style?: StrokeStyle): void;
  rect(a: Point2D, b: Point2D, style?: ShapeStyle): void;
  circle(center: Point2D, radius: number, style?: ShapeStyle): void;
  path(points: Point2D[], closed?: boolean, style?: ShapeStyle): void;
  handle(point: Point2D, style?: HandleStyle): void;
  readonly renderer: IRenderer;
}

const DEFAULT_STROKE: StrokeStyle = {
  stroke: "#0066ff",
  strokeWidth: 1,
};

const DEFAULT_SHAPE: ShapeStyle = {
  stroke: "#0066ff",
  strokeWidth: 1,
  fill: "rgba(0, 102, 255, 0.1)",
};

const DEFAULT_HANDLE: HandleStyle = {
  size: 4,
  fill: "#ffffff",
  stroke: "#0066ff",
  strokeWidth: 1,
};

export function createDrawAPI(renderer: IRenderer): DrawAPI {
  const applyStrokeStyle = (style?: StrokeStyle): void => {
    const s = { ...DEFAULT_STROKE, ...style };
    if (s.stroke) renderer.strokeStyle = s.stroke;
    if (s.strokeWidth) renderer.lineWidth = s.strokeWidth;
    if (s.dash) renderer.dashPattern = s.dash;
  };

  const applyShapeStyle = (style?: ShapeStyle): void => {
    const s = { ...DEFAULT_SHAPE, ...style };
    if (s.stroke) renderer.strokeStyle = s.stroke;
    if (s.strokeWidth) renderer.lineWidth = s.strokeWidth;
    if (s.fill) renderer.fillStyle = s.fill;
    if (s.dash) renderer.dashPattern = s.dash;
  };

  return {
    renderer,

    line(from: Point2D, to: Point2D, style?: StrokeStyle): void {
      renderer.save();
      applyStrokeStyle(style);
      renderer.drawLine(from.x, from.y, to.x, to.y);
      renderer.restore();
    },

    rect(a: Point2D, b: Point2D, style?: ShapeStyle): void {
      renderer.save();
      applyShapeStyle(style);

      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);

      if (style?.fill) {
        renderer.fillRect(x, y, width, height);
      }
      if (style?.stroke !== "none") {
        renderer.strokeRect(x, y, width, height);
      }
      renderer.restore();
    },

    circle(center: Point2D, radius: number, style?: ShapeStyle): void {
      renderer.save();
      applyShapeStyle(style);

      if (style?.fill) {
        renderer.fillCircle(center.x, center.y, radius);
      }
      if (style?.stroke !== "none") {
        renderer.strokeCircle(center.x, center.y, radius);
      }
      renderer.restore();
    },

    path(points: Point2D[], closed = false, style?: ShapeStyle): void {
      if (points.length < 2) return;

      renderer.save();
      applyShapeStyle(style);

      renderer.beginPath();
      renderer.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length; i++) {
        renderer.lineTo(points[i].x, points[i].y);
      }

      if (closed) {
        renderer.closePath();
      }

      if (style?.fill) {
        renderer.fill();
      }
      if (style?.stroke !== "none") {
        renderer.stroke();
      }
      renderer.restore();
    },

    handle(point: Point2D, style?: HandleStyle): void {
      const h = { ...DEFAULT_HANDLE, ...style };
      renderer.save();
      renderer.fillStyle = h.fill || "#ffffff";
      renderer.strokeStyle = h.stroke || "#0066ff";
      renderer.lineWidth = h.strokeWidth || 1;

      const size = h.size || 4;
      renderer.fillCircle(point.x, point.y, size);
      renderer.strokeCircle(point.x, point.y, size);
      renderer.restore();
    },
  };
}
