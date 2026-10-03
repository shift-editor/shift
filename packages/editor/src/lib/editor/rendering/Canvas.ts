import { Bounds, Mat, type MatModel, type Point2D } from "@shift/geo";
import { readEditorRenderTheme, type EditorRenderTheme } from "./Theme";
import type { CameraTransform } from "../managers/Camera";

/**
 * Single 2D rendering API wrapping CanvasRenderingContext2D.
 *
 * @remarks
 * Tracks the transform from the current drawing units to logical screen
 * pixels, so pixel-sized strokes and markers stay the same size on screen
 * whatever units the caller draws in. Transforms applied directly to `ctx`
 * are not tracked; keep them to leaf drawing that does not size in pixels.
 * Generic — knows nothing about fonts or glyphs.
 */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: EditorRenderTheme;
  #camera: CameraTransform;
  #transform = Mat.Identity();
  #pixelsPerUnit = 1;
  readonly #saved: { transform: Mat; pixelsPerUnit: number }[] = [];

  constructor(
    ctx: CanvasRenderingContext2D,
    camera: CameraTransform,
    theme: EditorRenderTheme = readEditorRenderTheme(),
  ) {
    this.ctx = ctx;
    this.#camera = camera;
    this.theme = theme;
  }

  /** Camera snapshot for the frame being drawn. */
  get camera(): CameraTransform {
    return this.#camera;
  }

  /** Starts a new frame: adopts the camera snapshot and resets to screen space. */
  set camera(camera: CameraTransform) {
    this.#camera = camera;
    this.#transform = Mat.Identity();
    this.#pixelsPerUnit = 1;
    this.#saved.length = 0;
  }

  /**
   * Transform from the current drawing units to logical screen pixels.
   *
   * @returns a live view; it changes as drawing enters and leaves transforms.
   */
  get transform(): MatModel {
    return this.#transform;
  }

  /** Converts a length in screen pixels to the current drawing units. */
  pxToUnits(px: number): number {
    return px / this.#pixelsPerUnit;
  }

  /**
   * Returns the canvas area, grown by a margin, in the current drawing units.
   *
   * @param marginPx - extra logical pixels on every side, so content just off-screen is included.
   * @returns fresh bounds covering the four transformed canvas corners.
   */
  visibleBounds(marginPx: number): Bounds {
    const inverse = Mat.Inverse(this.#transform);
    const min = -marginPx;
    const maxX = this.#camera.logicalWidth + marginPx;
    const maxY = this.#camera.logicalHeight + marginPx;
    const corners = [
      { x: min, y: min },
      { x: maxX, y: min },
      { x: maxX, y: maxY },
      { x: min, y: maxY },
    ].map((corner) => Mat.applyToPoint(inverse, corner));

    return Bounds.fromPoints(corners)!;
  }

  line(from: Point2D, to: Point2D, stroke: string, widthPx: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUnits(widthPx);
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
    this.ctx.lineWidth = this.pxToUnits(widthPx);
    this.ctx.setLineDash(dashPx.map((d) => this.pxToUnits(d)));
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
    this.ctx.lineWidth = this.pxToUnits(widthPx);
    this.ctx.setLineDash(dashPx.map((d) => this.pxToUnits(d)));
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
    this.ctx.lineWidth = this.pxToUnits(widthPx);
    this.ctx.setLineDash([]);
    this.ctx.stroke(path);
    this.ctx.restore();
  }

  /**
   * Runs a drawing callback in scene coordinates.
   *
   * @param draw - Drawing operation to run while the context maps scene units to the screen.
   */
  withSceneSpace(draw: (canvas: Canvas) => void): void {
    this.withTransform(this.camera.view, draw);
  }

  /**
   * Runs a drawing callback with a transform appended to the current one.
   *
   * @param transform - Maps the callback's coordinates into the current drawing space.
   * @param draw - Drawing operation to run in the transformed space.
   */
  withTransform(transform: MatModel, draw: (canvas: Canvas) => void): void {
    this.save();
    this.#apply(transform);

    try {
      draw(this);
    } finally {
      this.restore();
    }
  }

  /**
   * Runs a drawing callback in logical screen pixels.
   *
   * @param draw - Drawing operation to run with one unit equal to one screen pixel.
   */
  withScreenSpace(draw: (canvas: Canvas) => void): void {
    this.withTransform(Mat.Inverse(this.#transform), draw);
  }

  /** @knipclassignore */
  circle(center: Point2D, radiusPx: number, fill: string): void {
    const r = this.pxToUnits(radiusPx);
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /** @knipclassignore */
  strokeCircle(center: Point2D, radiusPx: number, stroke: string, widthPx: number): void {
    const r = this.pxToUnits(radiusPx);
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.pxToUnits(widthPx);
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
    const r = this.pxToUnits(radiusPx);
    this.ctx.save();
    this.ctx.lineWidth = this.pxToUnits(widthPx);
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.strokeStyle = stroke;
    this.ctx.stroke();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.restore();
  }

  /** Saves the context state and the tracked transform. */
  save(): void {
    this.ctx.save();
    this.#saved.push({ transform: Mat.Copy(this.#transform), pixelsPerUnit: this.#pixelsPerUnit });
  }

  /** Restores the context state and the tracked transform from the matching {@link save}. */
  restore(): void {
    this.ctx.restore();
    const saved = this.#saved.pop();
    if (!saved) return;

    this.#transform = saved.transform;
    this.#pixelsPerUnit = saved.pixelsPerUnit;
  }

  /** @knipclassignore */
  translate(x: number, y: number): void {
    this.#apply(Mat.Translate(x, y));
  }

  /** @knipclassignore */
  rotate(angle: number): void {
    this.#apply(Mat.Rotate(angle));
  }

  /** @knipclassignore */
  scale(x: number, y: number): void {
    this.#apply(Mat.Scale(x, y));
  }

  #apply(transform: MatModel): void {
    this.ctx.transform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f,
    );
    this.#transform.multiply(transform);
    const { a, b, c, d } = this.#transform;
    this.#pixelsPerUnit = Math.sqrt(Math.abs(a * d - b * c));
  }

  /** @knipclassignore */
  clear(): void {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
  }
}
