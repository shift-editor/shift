import { Canvas, CanvasKit, Paint, Path, Surface } from "canvaskit-wasm";
import { IRenderer } from "../../../types/renderer";
import {
  DEFAULT_STYLES,
  DrawStyle,
  StrokeStyle,
} from "../../draw/styles/style";
import { IGraphicContext } from "../GraphicContext";

export class CanvasKitContext implements IGraphicContext<Surface> {
  #ctx: CanvasKit;
  #surface: Surface | null = null;

  public constructor(ctx: CanvasKit) {
    this.#ctx = ctx;
  }

  public get ctx(): CanvasKit {
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
    const s = this.#ctx.MakeWebGLCanvasSurface(canvas);
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

export class CanvasKitRenderer implements IRenderer {
  #ctx: CanvasKitContext;
  #surface: Surface | null = null;

  public constructor(ctx: CanvasKitContext) {
    this.#ctx = ctx;
  }

  public get ctx(): IGraphicContext<Surface> {
    return this.#ctx;
  }

  public createSurface(canvas: HTMLCanvasElement): void {
    this.#ctx.createSurface(canvas);
  }

  public recreateSurface(canvas: HTMLCanvasElement): void {
    this.#ctx.recreateSurface(canvas);
  }

  public get surface(): Surface {
    return this.#ctx.surface;
  }

  public get canvas(): Canvas {
    if (!this.#surface) {
      throw new Error("Surface not initialized");
    }
    return this.#surface.getCanvas();
  }

  private getStyledPainter(style: Partial<DrawStyle> = {}): Paint {
    const finalStyle = { ...DEFAULT_STYLES, ...style };
    const p = new this.ctx.Paint();

    p.setStrokeWidth(finalStyle.strokeWidth);

    const paintStyle = this.ctx.PaintStyle;
    const strokeStyle =
      finalStyle.strokeStyle == StrokeStyle.Fill
        ? paintStyle.Fill
        : paintStyle.Stroke;

    p.setStyle(strokeStyle);
    const [r, g, b] = finalStyle.strokeColour.rgb();
    p.setColor(this.ctx.Color4f(r / 255, g / 255, b / 255, 1.0));

    p.setAntiAlias(finalStyle.antialias ?? true);

    return p;
  }

  save(): void {
    this.canvas.save();
  }

  restore(): void {
    this.canvas.restore();
  }

  flush(): void {
    this.surface.flush();
  }

  clear(): void {
    this.canvas.clear(this.#ctx.WHITE);
  }

  dispose(): void {
    this.surface.delete();
    this.canvas.delete();
  }

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);
    this.canvas.drawLine(x0, y0, x1, y1, p);
  }

  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);

    const rect = this.ctx.XYWHRect(x, y, width, height);
    this.canvas.drawRect(rect, p);
  }

  drawCircle(
    x: number,
    y: number,
    radius: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);

    this.canvas.drawCircle(x, y, radius, p);
  }

  #path: Path | null = null;

  beginPath(): void {
    this.#path = new this.ctx.Path();
  }

  get path(): Path {
    if (!this.#path) {
      console.warn(
        "Path operation called without beginPath(), creating new path"
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
    y: number
  ): void {
    this.path.cubicTo(cpx1, cpy1, cpx2, cpy2, x, y);
  }

  close(): void {
    this.path.close();
  }

  drawPath(style?: Partial<DrawStyle>): void {
    const p = this.getStyledPainter(style);
    this.canvas.drawPath(this.path, p);

    this.path.delete();
    p.delete();

    this.#path = null;
  }

  stroke(): void {
    this.path.stroke();
  }
}
