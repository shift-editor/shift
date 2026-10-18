import { Bounds, Mat, type MatModel, type Point2D } from "@shift/geo";
import { readEditorRenderTheme, type EditorRenderTheme } from "./Theme";
import type { CameraTransform } from "../managers/Camera";
import type { ScreenPoint } from "../../../types/coordinates";
import { screenPoint } from "../spaces";

declare const screenSpace: unique symbol;

/**
 * A {@link Canvas} whose drawing units are logical screen pixels.
 *
 * @remarks
 * Only {@link Canvas.withScreenSpace} hands one out, so drawing that sizes
 * shapes in pixels can require it and cannot be called from node units.
 */
export type ScreenCanvas = Canvas & { readonly [screenSpace]: true };

/** Maps positions and directions from the units outside a screen-space block to screen pixels. */
export interface ScreenProjection {
  /** Returns a point from the outer drawing units as a screen point. */
  point(point: Point2D): ScreenPoint;
  /** Returns the on-screen angle of a direction given in the outer drawing units. */
  angle(angle: number): number;
}

/** Styles shared by every path a {@link PathBatch} paints. */
export interface PathBatchStyle {
  readonly fill: string;
  readonly stroke: string;
  /** Stroke width in screen pixels. */
  readonly widthPx: number;
}

/**
 * Paints retained paths in one style at offsets in the units current when the batch began.
 *
 * @remarks
 * Only valid inside {@link Canvas.withPathBatch}.
 */
export interface PathBatch {
  /** Moves the origin to `(x, y)` in the batch's units; later drawing happens there. */
  offset(x: number, y: number): void;
  /** Fills a path at the current offset with the batch's fill. */
  fill(path: Path2D): void;
  /** Strokes a path at the current offset with the batch's stroke and width. */
  stroke(path: Path2D): void;
}

const NO_DASH: number[] = [];

/**
 * Single 2D rendering API wrapping CanvasRenderingContext2D.
 *
 * @remarks
 * Tracks the transform from the current drawing units to logical screen
 * pixels. Geometry is given in the current units; every width, dash, and
 * radius is given in screen pixels and is applied in screen space, so it
 * stays the same size on screen whatever units the caller draws in.
 * Transforms applied directly to `ctx` are not tracked; keep them to leaf
 * drawing. Generic — knows nothing about fonts or glyphs.
 */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: EditorRenderTheme;
  #camera: CameraTransform;
  #transform = Mat.Identity();
  #inverse: Mat | null = null;
  readonly #saved: Mat[] = [];

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
    this.#inverse = null;
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

  /**
   * Returns the canvas area, grown by a margin, in the current drawing units.
   *
   * @param marginPx - extra logical pixels on every side, so content just off-screen is included.
   * @returns fresh bounds covering the four transformed canvas corners.
   */
  visibleBounds(marginPx: number): Bounds {
    const inverse = this.#inverted();
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

  /**
   * Strokes the context's current path with a width in screen pixels.
   *
   * @remarks
   * Build the path on `ctx` in the current drawing units first; the stroke is
   * applied in screen space and leaves the path in place.
   */
  stroke(stroke: string, widthPx: number, dashPx: readonly number[] = []): void {
    this.ctx.save();
    this.#applyToContext(this.#inverted());
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = widthPx;
    this.ctx.setLineDash(dashPx as number[]);
    this.ctx.stroke();
    this.ctx.restore();
  }

  line(from: Point2D, to: Point2D, stroke: string, widthPx: number): void {
    this.dashedLine(from, to, stroke, widthPx, []);
  }

  dashedLine(
    from: Point2D,
    to: Point2D,
    stroke: string,
    widthPx: number,
    dashPx: readonly number[],
  ): void {
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.stroke(stroke, widthPx, dashPx);
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
    dashPx: readonly number[] = [],
  ): void {
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.stroke(stroke, widthPx, dashPx);
  }

  fillPath(path: Path2D, fill: string): void {
    this.ctx.save();
    this.ctx.fillStyle = fill;
    this.ctx.fill(path);
    this.ctx.restore();
  }

  /**
   * Strokes a retained path in place with a width in screen pixels.
   *
   * @remarks
   * A `Path2D` is read through the transform active when it is stroked, so
   * the width is scaled into the current units instead of resetting to
   * screen space. Exact for uniform scale; under non-uniform scale the width
   * is the geometric mean of the two axes.
   */
  strokePath(path: Path2D, stroke: string, widthPx: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = widthPx / this.#pixelsPerUnit();
    this.ctx.setLineDash(NO_DASH);
    this.ctx.stroke(path);
    this.ctx.restore();
  }

  /**
   * Paints many retained paths in one style, each at its own offset in the current units.
   *
   * @remarks
   * For drawing the same kind of shape many times (a run's glyphs). Saves
   * once and sets the styles once, then moves between offsets by translating
   * the context, instead of a save, translate, and restore per shape. Other
   * drawing inside `draw` happens at the current offset, and the `Canvas`
   * methods restore the batch's styles after themselves. The stroke width
   * follows {@link strokePath}: given in screen pixels, scaled into the
   * current units.
   *
   * @param style - Fill, stroke, and stroke width for {@link PathBatch.fill} and {@link PathBatch.stroke}.
   * @param draw - Paints through the batch; the batch is invalid after it returns.
   */
  withPathBatch(style: PathBatchStyle, draw: (batch: PathBatch) => void): void {
    this.save();
    const ctx = this.ctx;
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.widthPx / this.#pixelsPerUnit();
    ctx.setLineDash(NO_DASH);

    let x = 0;
    let y = 0;
    const batch: PathBatch = {
      offset: (nextX, nextY) => {
        const dx = nextX - x;
        const dy = nextY - y;
        if (dx === 0 && dy === 0) return;
        x = nextX;
        y = nextY;
        ctx.translate(dx, dy);
        // The product `ctx` applies; `save` keeps a copy, so updating in place is safe.
        const transform = this.#transform;
        transform.e += transform.a * dx + transform.c * dy;
        transform.f += transform.b * dx + transform.d * dy;
        this.#inverse = null;
      },
      fill: (path) => ctx.fill(path),
      stroke: (path) => ctx.stroke(path),
    };

    try {
      draw(batch);
    } finally {
      this.restore();
    }
  }

  /** Screen pixels per drawing unit, the geometric mean of the two axes' scales. */
  #pixelsPerUnit(): number {
    const { a, b, c, d } = this.#transform;
    return Math.sqrt(Math.abs(a * d - b * c));
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
   * @param draw - Drawing operation to run with one unit equal to one screen
   * pixel. `project` maps positions and directions from the units in effect
   * before the call, so callers never capture the transform themselves.
   *
   * @example
   * ```ts
   * canvas.withScreenSpace((screen, project) => {
   *   for (const anchor of anchors) drawHandle(screen, project.point(anchor), "anchor", state);
   * });
   * ```
   */
  withScreenSpace(draw: (screen: ScreenCanvas, project: ScreenProjection) => void): void {
    const outer = Mat.Copy(this.#transform);
    const project: ScreenProjection = {
      point: (point) => {
        const { x, y } = Mat.applyToPoint(outer, point);
        return screenPoint(x, y);
      },
      angle: (angle) => angleThrough(outer, angle),
    };

    this.withTransform(this.#inverted(), (canvas) => draw(asScreen(canvas), project));
  }

  /** @knipclassignore */
  circle(center: Point2D, radiusPx: number, fill: string): void {
    this.#screenCircle(center, radiusPx);
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.restore();
  }

  /** @knipclassignore */
  strokeCircle(center: Point2D, radiusPx: number, stroke: string, widthPx: number): void {
    this.#screenCircle(center, radiusPx);
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = widthPx;
    this.ctx.setLineDash([]);
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
    this.#screenCircle(center, radiusPx);
    this.ctx.lineWidth = widthPx;
    this.ctx.strokeStyle = stroke;
    this.ctx.stroke();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.restore();
  }

  /** Saves the context state and the tracked transform. */
  save(): void {
    this.ctx.save();
    this.#saved.push(Mat.Copy(this.#transform));
  }

  /** Restores the context state and the tracked transform from the matching {@link save}. */
  restore(): void {
    this.ctx.restore();
    const saved = this.#saved.pop();
    if (!saved) return;

    this.#transform = saved;
    this.#inverse = null;
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
    this.#applyToContext(transform);
    this.#transform.multiply(transform);
    this.#inverse = null;
  }

  #applyToContext(transform: MatModel): void {
    this.ctx.transform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f,
    );
  }

  #inverted(): Mat {
    this.#inverse ??= Mat.Inverse(this.#transform);
    return this.#inverse;
  }

  /** Opens a save, enters screen space, and traces a circle path; the caller paints and restores. */
  #screenCircle(center: Point2D, radiusPx: number): void {
    const screen = Mat.applyToPoint(this.#transform, center);
    this.ctx.save();
    this.#applyToContext(this.#inverted());
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
  }

  /** @knipclassignore */
  clear(): void {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
  }
}

/** Brands a canvas that the caller has just put into screen space. */
function asScreen(canvas: Canvas): ScreenCanvas {
  return canvas as ScreenCanvas;
}

/** Returns the angle a direction makes after the linear part of `transform` is applied. */
function angleThrough(transform: MatModel, angle: number): number {
  const { a, b, c, d } = transform;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  return Math.atan2(b * x + d * y, a * x + c * y);
}
