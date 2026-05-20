import type { Point2D } from "@shift/geo";
import type { Theme } from "./Theme";
import { DEFAULT_THEME } from "./Theme";
import type { CameraTransform } from "../managers/Camera";

/**
 * Single 2D rendering API wrapping CanvasRenderingContext2D.
 *
 * Owns camera state + theme. Converts px→UPM internally.
 * Generic — knows nothing about fonts or glyphs.
 */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: Theme;
  camera: CameraTransform;

  constructor(
    ctx: CanvasRenderingContext2D,
    camera: CameraTransform,
    theme: Theme = DEFAULT_THEME,
  ) {
    this.ctx = ctx;
    this.camera = camera;
    this.theme = theme;
  }

  /** Convert screen pixels to UPM units at the current zoom level. */
  pxToUpm(px: number): number {
    return px / (this.camera.upmScale * this.camera.zoom);
  }

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

  /** @knipclassignore */
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

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    stroke: string,
    widthPx: number,
    dashPx: number[] = [],
  ): void {
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

  /**
   * Run a drawing callback in glyph-local UPM coordinates.
   *
   * @param drawOffset - Glyph-local offset applied after the camera transform.
   * @param draw - Drawing operation to run while the context is in glyph space.
   */
  withGlyphSpace(drawOffset: Point2D, draw: (canvas: Canvas) => void): void {
    const camera = this.camera;

    this.ctx.save();
    this.ctx.transform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      camera.panX + camera.centre.x * (1 - camera.zoom),
      camera.panY + camera.centre.y * (1 - camera.zoom),
    );

    const baselineY = camera.layoutHeight - camera.padding - camera.descender * camera.upmScale;
    this.ctx.transform(camera.upmScale, 0, 0, -camera.upmScale, camera.padding, baselineY);
    this.ctx.translate(drawOffset.x, drawOffset.y);

    try {
      draw(this);
    } finally {
      this.ctx.restore();
    }
  }

  /** @knipclassignore */
  circle(center: Point2D, radiusPx: number, fill: string): void {
    const r = this.pxToUpm(radiusPx);
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /** @knipclassignore */
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

  filledStrokeCircle(
    center: Point2D,
    radiusPx: number,
    fill: string,
    stroke: string,
    widthPx: number,
  ): void {
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

  /** @knipclassignore Draw a screen-space circle (no pxToUpm conversion — for bounding box handles etc.). */
  screenCircle(
    center: Point2D,
    radius: number,
    fill: string,
    stroke: string,
    widthPx: number,
  ): void {
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

  /** @knipclassignore */
  save(): void {
    this.ctx.save();
  }

  /** @knipclassignore */
  restore(): void {
    this.ctx.restore();
  }

  /** @knipclassignore */
  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  /** @knipclassignore */
  rotate(angle: number): void {
    this.ctx.rotate(angle);
  }

  /** @knipclassignore */
  scale(x: number, y: number): void {
    this.ctx.scale(x, y);
  }

  /** @knipclassignore */
  clear(): void {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
  }
}
