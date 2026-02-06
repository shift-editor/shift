import type { Point2D } from "@shift/types";
import type {
  IRenderer,
  ScreenConverter,
  HandleType,
  HandleState,
  StrokeStyle,
  FillStyle,
  ShapeStyle,
} from "@/types/graphics";
import { Vec2 } from "@shift/geo";
import { HANDLE_STYLES } from "@/lib/styles/style";
import type { BaseHandleStyle } from "@/lib/styles/canvas/handles";
const START_TRIANGLE_GAP = 3;

export type { StrokeStyle, FillStyle, ShapeStyle };

export interface LastHandlePosition {
  anchor: Point2D;
  prev: Point2D;
}

export class DrawAPI {
  readonly #renderer: IRenderer;
  readonly #screen: ScreenConverter;

  constructor(renderer: IRenderer, screen: ScreenConverter) {
    this.#renderer = renderer;
    this.#screen = screen;
  }

  get renderer(): IRenderer {
    return this.#renderer;
  }

  #toUpm(px: number): number {
    return this.#screen.toUpmDistance(px);
  }

  line(from: Point2D, to: Point2D, style?: StrokeStyle): void {
    this.#renderer.save();
    if (style?.strokeStyle) this.#renderer.strokeStyle = style.strokeStyle;
    this.#renderer.lineWidth = this.#toUpm(style?.strokeWidth ?? 1);
    if (style?.dashPattern) {
      this.#renderer.dashPattern = style.dashPattern.map((v) => this.#toUpm(v));
    }
    this.#renderer.drawLine(from.x, from.y, to.x, to.y);
    this.#renderer.restore();
  }

  rect(a: Point2D, b: Point2D, style?: ShapeStyle): void {
    this.#renderer.save();

    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);

    this.#renderer.lineWidth = this.#toUpm(style?.strokeWidth ?? 1);
    if (style?.dashPattern) {
      this.#renderer.dashPattern = style.dashPattern.map((v) => this.#toUpm(v));
    }

    if (style?.fillStyle) {
      this.#renderer.fillStyle = style.fillStyle;
      this.#renderer.fillRect(x, y, width, height);
    }
    if (style?.strokeStyle) {
      this.#renderer.strokeStyle = style.strokeStyle;
      this.#renderer.strokeRect(x, y, width, height);
    }
    this.#renderer.restore();
  }

  circle(center: Point2D, radiusPx: number, style?: ShapeStyle): void {
    this.#renderer.save();
    const radiusUpm = this.#toUpm(radiusPx);
    this.#renderer.lineWidth = this.#toUpm(style?.strokeWidth ?? 1);
    if (style?.dashPattern) {
      this.#renderer.dashPattern = style.dashPattern.map((v) => this.#toUpm(v));
    }

    if (style?.fillStyle) {
      this.#renderer.fillStyle = style.fillStyle;
      this.#renderer.fillCircle(center.x, center.y, radiusUpm);
    }
    if (style?.strokeStyle) {
      this.#renderer.strokeStyle = style.strokeStyle;
      this.#renderer.strokeCircle(center.x, center.y, radiusUpm);
    }
    this.#renderer.restore();
  }

  path(points: Point2D[], closed = false, style?: ShapeStyle): void {
    if (points.length < 2) return;

    this.#renderer.save();
    this.#renderer.lineWidth = this.#toUpm(style?.strokeWidth ?? 1);
    if (style?.dashPattern) {
      this.#renderer.dashPattern = style.dashPattern.map((v) => this.#toUpm(v));
    }

    this.#renderer.beginPath();
    this.#renderer.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.#renderer.lineTo(points[i].x, points[i].y);
    }

    if (closed) {
      this.#renderer.closePath();
    }

    if (style?.fillStyle) {
      this.#renderer.fillStyle = style.fillStyle;
      this.#renderer.fill();
    }
    if (style?.strokeStyle) {
      this.#renderer.strokeStyle = style.strokeStyle;
      this.#renderer.stroke();
    }
    this.#renderer.restore();
  }

  handle(
    point: Point2D,
    type: Exclude<HandleType, "first" | "last" | "direction">,
    state: HandleState,
  ): void {
    const style = HANDLE_STYLES[type][state] as BaseHandleStyle;

    switch (type) {
      case "corner":
        this.#drawCornerHandle(point, style);
        break;
      case "control":
      case "smooth":
        this.#drawCircleHandle(point, style);
        break;
    }
  }

  #drawCornerHandle(point: Point2D, style: BaseHandleStyle): void {
    const sizeUpm = this.#toUpm(style.size);
    const half = sizeUpm / 2;

    this.#renderer.save();
    this.#renderer.lineWidth = this.#toUpm(style.lineWidth);
    this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.strokeStyle = style.strokeStyle;

    this.#renderer.fillRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
    this.#renderer.strokeRect(point.x - half, point.y - half, sizeUpm, sizeUpm);

    if (style.overlayColor) {
      this.#renderer.fillStyle = style.overlayColor;
      this.#renderer.strokeStyle = style.overlayColor;
      this.#renderer.fillRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
      this.#renderer.strokeRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
    }

    this.#renderer.restore();
  }

  #drawCircleHandle(point: Point2D, style: BaseHandleStyle): void {
    // For control/smooth handles, style.size IS the radius (not diameter)
    const radiusUpm = this.#toUpm(style.size);

    this.#renderer.save();
    this.#renderer.lineWidth = this.#toUpm(style.lineWidth);
    this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.strokeStyle = style.strokeStyle;

    // Draw stroke first, then fill on top (matches original renderer order)
    this.#renderer.strokeCircle(point.x, point.y, radiusUpm);
    this.#renderer.fillCircle(point.x, point.y, radiusUpm);

    if (style.overlayColor) {
      this.#renderer.fillStyle = style.overlayColor;
      this.#renderer.strokeStyle = style.overlayColor;
      this.#renderer.strokeCircle(point.x, point.y, radiusUpm);
      this.#renderer.fillCircle(point.x, point.y, radiusUpm);
    }

    this.#renderer.restore();
  }

  handleFirst(point: Point2D, angle: number, state: HandleState): void {
    const style = HANDLE_STYLES.first[state];
    const sizeUpm = this.#toUpm(style.size);
    const barSizeUpm = this.#toUpm(style.barSize);
    const lineWidthUpm = this.#toUpm(style.lineWidth);
    const gapUpm = this.#toUpm(START_TRIANGLE_GAP);

    this.#renderer.save();
    this.#renderer.lineWidth = lineWidthUpm;

    // Draw bar with its own stroke style
    const perpAngle = angle + Math.PI / 2;
    this.#renderer.strokeStyle = style.barStrokeStyle;
    this.#drawHorizontalLine(point.x, point.y, barSizeUpm, perpAngle);

    // Draw triangle with fill/stroke styles
    this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.strokeStyle = style.strokeStyle;
    const direction = Vec2.fromAngle(angle);
    const triangleOffset = Vec2.scale(direction, gapUpm + sizeUpm);
    const trianglePos = Vec2.add(point, triangleOffset);
    this.#drawTriangle(trianglePos.x, trianglePos.y, sizeUpm, angle);

    if (style.overlayColor) {
      this.#renderer.strokeStyle = style.overlayColor;
      this.#drawHorizontalLine(point.x, point.y, barSizeUpm, perpAngle);
      this.#renderer.fillStyle = style.overlayColor;
      this.#drawTriangle(trianglePos.x, trianglePos.y, sizeUpm, angle);
    }

    this.#renderer.restore();
  }

  handleDirection(point: Point2D, angle: number, state: HandleState): void {
    const style = HANDLE_STYLES.direction[state];
    const sizeUpm = this.#toUpm(style.size);
    const lineWidthUpm = this.#toUpm(style.lineWidth);

    this.#renderer.save();
    this.#renderer.lineWidth = lineWidthUpm;
    this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.strokeStyle = style.strokeStyle;

    this.#drawTriangle(point.x, point.y, sizeUpm, angle);

    if (style.overlayColor) {
      this.#renderer.fillStyle = style.overlayColor;
      this.#renderer.strokeStyle = style.overlayColor;
      this.#drawTriangle(point.x, point.y, sizeUpm, angle);
    }

    this.#renderer.restore();
  }

  handleLast(pos: LastHandlePosition, state: HandleState): void {
    const style = HANDLE_STYLES.last[state];
    const sizeUpm = this.#toUpm(style.size);
    const lineWidthUpm = this.#toUpm(style.lineWidth);

    this.#renderer.save();
    this.#renderer.lineWidth = lineWidthUpm;
    this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.strokeStyle = style.strokeStyle;

    const angle = Vec2.angleTo(pos.anchor, pos.prev);
    const perpAngle = angle + Math.PI / 2;

    this.#drawHorizontalLine(pos.anchor.x, pos.anchor.y, sizeUpm, perpAngle);

    if (style.overlayColor) {
      this.#renderer.fillStyle = style.overlayColor;
      this.#renderer.strokeStyle = style.overlayColor;
      this.#drawHorizontalLine(pos.anchor.x, pos.anchor.y, sizeUpm, perpAngle);
    }

    this.#renderer.restore();
  }

  controlLine(anchor: Point2D, control: Point2D, state: HandleState): void {
    const style = HANDLE_STYLES.control[state];
    const lineWidthUpm = this.#toUpm(style.lineWidth);

    this.#renderer.save();
    this.#renderer.lineWidth = lineWidthUpm;
    this.#renderer.strokeStyle = style.strokeStyle;
    this.#renderer.drawLine(anchor.x, anchor.y, control.x, control.y);
    this.#renderer.restore();

    this.handle(control, "control", state);
  }

  beginPath(): void {
    this.#renderer.beginPath();
  }

  moveTo(point: Point2D): void {
    this.#renderer.moveTo(point.x, point.y);
  }

  lineTo(point: Point2D): void {
    this.#renderer.lineTo(point.x, point.y);
  }

  quadTo(control: Point2D, end: Point2D): void {
    this.#renderer.quadTo(control.x, control.y, end.x, end.y);
  }

  cubicTo(c1: Point2D, c2: Point2D, end: Point2D): void {
    this.#renderer.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  }

  closePath(): void {
    this.#renderer.closePath();
  }

  fill(style?: FillStyle): void {
    this.#renderer.save();
    if (style?.fillStyle) this.#renderer.fillStyle = style.fillStyle;
    this.#renderer.fill();
    this.#renderer.restore();
  }

  stroke(style?: StrokeStyle): void {
    this.#renderer.save();
    if (style?.strokeStyle) this.#renderer.strokeStyle = style.strokeStyle;
    this.#renderer.lineWidth = this.#toUpm(style?.strokeWidth ?? 1);
    if (style?.dashPattern) {
      this.#renderer.dashPattern = style.dashPattern.map((v) => this.#toUpm(v));
    }
    this.#renderer.stroke();
    this.#renderer.restore();
  }

  setStyle(style: { strokeStyle?: string; fillStyle?: string; lineWidth?: number }): void {
    if (style.strokeStyle) this.#renderer.strokeStyle = style.strokeStyle;
    if (style.fillStyle) this.#renderer.fillStyle = style.fillStyle;
    if (style.lineWidth !== undefined) this.#renderer.lineWidth = this.#toUpm(style.lineWidth);
  }

  #drawHorizontalLine(x: number, y: number, width: number, angle: number): void {
    this.#renderer.save();
    this.#renderer.translate(x, y);
    this.#renderer.rotate(angle);
    this.#renderer.drawLine(-width / 2, 0, width / 2, 0);
    this.#renderer.restore();
  }

  #drawTriangle(x: number, y: number, size: number, angle: number): void {
    this.#renderer.save();
    this.#renderer.translate(x, y);
    this.#renderer.rotate(angle);
    this.#renderer.beginPath();
    this.#renderer.moveTo(size, 0);
    this.#renderer.lineTo(-size / 2, -size * 0.866);
    this.#renderer.lineTo(-size / 2, size * 0.866);
    this.#renderer.closePath();
    this.#renderer.fill();
    this.#renderer.stroke();
    this.#renderer.restore();
  }
}
