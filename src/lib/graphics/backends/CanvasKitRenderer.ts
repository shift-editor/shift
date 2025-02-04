import { Canvas, CanvasKit, Paint, Path, Surface } from "canvaskit-wasm";
import chroma from "chroma-js";

import { IGraphicContext, IRenderer } from "../../../types/graphics";
import { DEFAULT_STYLES, DrawStyle } from "../../draw/styles/style";

export class CanvasKitRenderer implements IRenderer {
  #ctx: CanvasKitContext;
  #currentStyle: DrawStyle = { ...DEFAULT_STYLES };
  #path: Path | null = null;

  public constructor(ctx: CanvasKitContext) {
    this.#ctx = ctx;
  }

  public get ctx(): CanvasKitContext {
    return this.#ctx;
  }

  public get canvas(): Canvas {
    return this.#ctx.canvas;
  }

  public get lineWidth(): number {
    return this.#currentStyle.lineWidth;
  }

  public get strokeStyle(): string {
    return this.#currentStyle.strokeStyle;
  }

  public get fillStyle(): string {
    return this.#currentStyle.fillStyle;
  }

  public set lineWidth(width: number) {
    this.#currentStyle.lineWidth = width;
  }

  public set strokeStyle(style: string) {
    this.#currentStyle.strokeStyle = style;
  }

  public set fillStyle(style: string) {
    this.#currentStyle.fillStyle = style;
  }

  private getPaint(): Paint {
    const p = new this.ctx.canvasKit.Paint();

    p.setStrokeWidth(this.#currentStyle.lineWidth);

    const [r, g, b] = chroma(this.#currentStyle.strokeStyle).rgb();
    p.setColor(this.ctx.canvasKit.Color4f(r / 255, g / 255, b / 255, 1.0));

    p.setAntiAlias(this.#currentStyle.antialias ?? true);

    return p;
  }

  save(): void {
    this.canvas.save();
  }

  restore(): void {
    this.canvas.restore();
  }

  flush(): void {
    this.#ctx.surface.flush();
  }

  clear(): void {
    this.canvas.clear(this.ctx.canvasKit.WHITE);
  }

  dispose(): void {
    this.#ctx.surface.delete();
    this.canvas.delete();
  }

  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const p = this.getPaint();
    this.canvas.drawLine(x0, y0, x1, y1, p);
    p.delete();
  }

  drawRect(x: number, y: number, width: number, height: number): void {
    const p = this.getPaint();

    const rect = this.#ctx.canvasKit.XYWHRect(x, y, width, height);
    this.canvas.drawRect(rect, p);

    p.delete();
  }

  drawCircle(x: number, y: number, radius: number): void {
    const p = this.getPaint();
    this.canvas.drawCircle(x, y, radius, p);
    p.delete();
  }

  beginPath(): void {
    this.#path = new this.#ctx.canvasKit.Path();
  }

  get path(): Path {
    if (!this.#path) {
      console.warn(
        "Path operation called without beginPath(), creating new path",
      );
      this.beginPath();
    }
    return this.#path!;
  }

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }

  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number,
  ): void {
    this.path.cubicTo(cpx1, cpy1, cpx2, cpy2, x, y);
  }

  close(): void {
    this.path.close();
  }

  stroke(): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    this.canvas.drawPath(this.path, p);

    this.path.delete();
    p.delete();

    this.#path = null;
  }

  fill(): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Fill);
    this.canvas.drawPath(this.path, p);

    this.path.delete();
    p.delete();
  }

  scale(x: number, y: number): void {
    this.canvas.scale(x, y);
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const matrix = [a, c, e, b, d, f, 0, 0, 1];

    this.canvas.concat(matrix);
  }
}

export class CanvasKitContext implements IGraphicContext {
  #canvasKit: CanvasKit;
  #ctx: CanvasKitRenderer;
  #surface: Surface | null = null;

  public constructor(canvasKit: CanvasKit) {
    this.#canvasKit = canvasKit;
    this.#ctx = new CanvasKitRenderer(this);
  }

  public get canvasKit(): CanvasKit {
    return this.#canvasKit;
  }

  public getContext(): CanvasKitRenderer {
    return this.#ctx;
  }

  public get surface(): Surface {
    if (!this.#surface) {
      throw new Error("Surface not initialized");
    }
    return this.#surface;
  }

  public get canvas(): Canvas {
    if (!this.#surface) {
      throw new Error("Surface not initialized");
    }
    return this.#surface.getCanvas();
  }

  public createSurface(canvas: HTMLCanvasElement): void {
    const s = this.#canvasKit.MakeWebGLCanvasSurface(canvas);
    this.#surface = s;
  }

  public recreateSurface(canvas: HTMLCanvasElement): void {
    this.surface.delete();
    this.createSurface(canvas);
  }

  public dispose(): void {
    this.surface.delete();
  }
}
