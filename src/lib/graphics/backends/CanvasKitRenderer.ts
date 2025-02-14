import InitCanvasKit, {
  Canvas,
  CanvasKit,
  Paint,
  Path,
  Rect,
  Surface,
} from "canvaskit-wasm";
import chroma from "chroma-js";

import { DrawStyle, DEFAULT_STYLES } from "@/lib/gfx/styles/style";
import { getEditor } from "@/store/store";
import { IGraphicContext, IRenderer, IPath, Colour } from "@/types/graphics";
import { Rect2D } from "@/types/math";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export class CanvasKitPath implements IPath {
  #path: Path;

  constructor(canvasKit: CanvasKit) {
    this.#path = new canvasKit.Path();
  }

  moveTo(x: number, y: number): void {
    this.#path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.#path.lineTo(x, y);
  }

  cubicTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.#path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  closePath(): void {
    this.#path.close();
  }

  _getNativePath(): Path {
    return this.#path;
  }
}

export class CanvasKitRenderer implements IRenderer {
  #ctx: CanvasKitContext;
  #currentStyle: DrawStyle = { ...DEFAULT_STYLES };
  #path: Path;

  #paint: Paint;
  #strokeColour: Colour = [0, 0, 0, 1];
  #fillColour: Colour = [0, 0, 0, 1];

  public constructor(ctx: CanvasKitContext) {
    this.#ctx = ctx;

    this.#path = new this.#ctx.canvasKit.Path();
    this.#paint = new this.#ctx.canvasKit.Paint();
  }

  public get ctx(): CanvasKitContext {
    return this.#ctx;
  }

  public get canvas(): Canvas {
    return this.#ctx.canvas;
  }

  public setStyle(style: DrawStyle): void {
    this.#currentStyle = {
      ...DEFAULT_STYLES,
      ...style,
    };

    this.strokeStyle = this.#currentStyle.strokeStyle;
    this.fillStyle = this.#currentStyle.fillStyle;
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
    this.#strokeColour = chroma(style).rgba();
  }

  public set fillStyle(style: string) {
    this.#currentStyle.fillStyle = style;
    this.#fillColour = chroma(style).rgba();
  }

  public set antiAlias(value: boolean) {
    this.#currentStyle.antiAlias = value;
  }

  public get antiAlias(): boolean {
    return this.#currentStyle.antiAlias ?? true;
  }

  setStrokeColour(): void {
    this.#paint.setColor(
      this.ctx.canvasKit.Color4f(
        this.#strokeColour[0] / 255,
        this.#strokeColour[1] / 255,
        this.#strokeColour[2] / 255,
        this.#strokeColour[3],
      ),
    );
  }

  setFillColour(): void {
    this.#paint.setColor(
      this.ctx.canvasKit.Color4f(
        this.#fillColour[0] / 255,
        this.#fillColour[1] / 255,
        this.#fillColour[2] / 255,
        this.#fillColour[3],
      ),
    );
  }

  setFill(): void {
    this.#paint.setStyle(this.ctx.canvasKit.PaintStyle.Fill);
    this.setFillColour();
  }

  setStroke(): void {
    this.#paint.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    this.setStrokeColour();
  }

  getPaint(): Paint {
    this.#paint.setStrokeWidth(this.#currentStyle.lineWidth);
    this.#paint.setAntiAlias(this.#currentStyle.antiAlias ?? true);
    return this.#paint;
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
    this.canvas.drawLine(x0, y0, x1, y1, this.getPaint());
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.setFill();
    const rect = this.#ctx.canvasKit.XYWHRect(x, y, width, height);
    this.canvas.drawRect(rect, this.getPaint());
  }

  fillCircle(x: number, y: number, radius: number): void {
    this.setFill();
    this.canvas.drawCircle(x, y, radius, this.getPaint());
  }

  createPath(): IPath {
    return new CanvasKitPath(this.#ctx.canvasKit);
  }

  beginPath(): void {
    this.#path.reset();
  }

  moveTo(x: number, y: number): void {
    this.#path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.#path.lineTo(x, y);
  }

  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number,
  ): void {
    this.#path.cubicTo(cpx1, cpy1, cpx2, cpy2, x, y);
  }

  closePath(): void {
    this.#path.close();
  }

  stroke(path?: IPath): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    this.setStrokeColour();

    if (path instanceof CanvasKitPath) {
      this.canvas.drawPath(path._getNativePath(), p);
      return;
    }
    this.canvas.drawPath(this.#path, p);
    this.#path.reset();
  }

  fill(path?: IPath): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Fill);

    if (path) {
      this.canvas.drawPath(
        path instanceof CanvasKitPath ? path._getNativePath() : this.#path,
        p,
      );
      return;
    }

    this.canvas.drawPath(this.#path, p);
    this.#path.reset();
  }

  scale(x: number, y: number): void {
    this.canvas.scale(x, y);
  }

  translate(x: number, y: number): void {
    this.canvas.translate(x, y);
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
  #canvas: Canvas | null = null;

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
    if (!this.#canvas) {
      throw new Error("Canvas not initialized");
    }
    return this.#canvas;
  }

  public createSurface(canvas: HTMLCanvasElement): void {
    if (this.#surface) {
      this.#surface.delete();
      this.#surface = null;
    }

    const s = this.#canvasKit.MakeWebGLCanvasSurface(canvas, undefined, {
      alpha: 1, // No transparency needed for font editing
      antialias: 1, // Enable antialiasing for smooth curves
      depth: 0, // No depth buffer needed for 2D
      premultipliedAlpha: 0, // Since alpha is disabled
      preserveDrawingBuffer: 1, // Important for continuous rendering during panning
      stencil: 0, // No stencil buffer needed for basic font editing
    });

    this.#surface = s;

    if (s) {
      this.#canvas = s.getCanvas();
    }
  }

  public resizeCanvas(canvas: HTMLCanvasElement, rect: DOMRectReadOnly): void {
    const dpr = window.devicePixelRatio;
    const viewportRect = canvas.getBoundingClientRect();

    const width = Math.floor(viewportRect.width * dpr);
    const height = Math.floor(viewportRect.height * dpr);

    const editor = getEditor();
    editor.setRect({
      x: viewportRect.x,
      y: viewportRect.y,
      width: viewportRect.width,
      height: viewportRect.height,
      left: viewportRect.left,
      top: viewportRect.top,
      right: viewportRect.right,
      bottom: viewportRect.bottom,
    });

    canvas.width = width;
    canvas.height = height;

    this.createSurface(canvas);
    this.canvas.scale(dpr, dpr);
  }

  public dispose(): void {
    this.surface.delete();
  }

  public destroy(): void {
    if (this.#surface) {
      this.#surface.delete();
      this.#surface = null;
    }
  }
}
