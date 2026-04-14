import type { Point2D } from "@shift/types";
import type { Theme } from "./Theme";
import { DEFAULT_THEME } from "./Theme";
import type { ViewportTransform } from "./Viewport";

/**
 * Single 2D rendering API wrapping CanvasRenderingContext2D.
 *
 * Owns viewport state + theme. Converts px→UPM internally.
 * Generic — knows nothing about fonts or glyphs.
 */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: Theme;
  readonly viewport: ViewportTransform;

  constructor(
    ctx: CanvasRenderingContext2D,
    viewport: ViewportTransform,
    theme: Theme = DEFAULT_THEME,
  ) {
    this.ctx = ctx;
    this.viewport = viewport;
    this.theme = theme;
  }

  /** Convert screen pixels to UPM units at the current zoom level. */
  pxToUpm(px: number): number {
    return px / (this.viewport.upmScale * this.viewport.zoom);
  }

  // ── Primitives ──

  line(from: Point2D, to: Point2D, stroke: string, widthPx: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  dashedLine(from: Point2D, to: Point2D, stroke: string, widthPx: number, dashPx: number[]): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.setLineDash(dashPx.map((d) => this.pxToUpm(d)));
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  fillRect(x: number, y: number, w: number, h: number, fill: string): void {
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.restore();
  }

  strokeRect(x: number, y: number, w: number, h: number, stroke: string, widthPx: number, dashPx: number[] = []): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.setLineDash(dashPx.map((d) => this.pxToUpm(d)));
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.restore();
  }

  fillPath(path: Path2D, fill: string): void {
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.fill(path);
    this.ctx.restore();
  }

  strokePath(path: Path2D, stroke: string, widthPx: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.setLineDash([]);
    this.ctx.stroke(path);
    this.ctx.restore();
  }

  circle(center: Point2D, radiusPx: number, fill: string): void {
    const r = this.pxToUpm(radiusPx);
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  strokeCircle(center: Point2D, radiusPx: number, stroke: string, widthPx: number): void {
    const r = this.pxToUpm(radiusPx);
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  filledStrokeCircle(center: Point2D, radiusPx: number, fill: string, stroke: string, widthPx: number): void {
    const r = this.pxToUpm(radiusPx);
    this.ctx.save();
    this.ctx.lineWidth = this.pxToUpm(widthPx);
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.strokeStyle = stroke;
    this.ctx.stroke();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.restore();
  }

  /** Draw a screen-space circle (no pxToUpm conversion — for bounding box handles etc.). */
  screenCircle(center: Point2D, radius: number, fill: string, stroke: string, widthPx: number): void {
    this.ctx.save();
    this.ctx.lineWidth = widthPx;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = stroke;
    this.ctx.stroke();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.restore();
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  rotate(angle: number): void {
    this.ctx.rotate(angle);
  }

  scale(x: number, y: number): void {
    this.ctx.scale(x, y);
  }

  clear(): void {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
  }
}
