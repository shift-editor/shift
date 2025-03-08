import InitCanvasKit, {
  Canvas,
  CanvasKit,
  Paint,
  Path,
  Surface,
} from "canvaskit-wasm";
import chroma from "chroma-js";

import { DEFAULT_STYLES, DrawStyle } from "@/lib/styles/style";
import { getEditor } from "@/store/store";
import { IGraphicContext, IRenderer, IPath, Colour } from "@/types/graphics";

import { Path2D } from "../Path";

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

  #cachedPaths: Map<Path2D, Path> = new Map();

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
    this.#currentStyle = style;

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

  public set dashPattern(pattern: number[]) {
    this.#currentStyle.dashPattern = pattern;
  }

  public get dashPattern(): number[] {
    return this.#currentStyle.dashPattern;
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

    this.#paint.setPathEffect(null);
    if (this.#currentStyle.dashPattern.length > 0) {
      this.#paint.setPathEffect(
        this.ctx.canvasKit.PathEffect.MakeDash(
          this.#currentStyle.dashPattern,
          0,
        ),
      );
    }
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
    this.canvas.clear(this.ctx.canvasKit.TRANSPARENT);
  }

  dispose(): void {
    this.#ctx.surface.delete();
    this.canvas.delete();
  }

  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    this.setStroke();
    this.canvas.drawLine(x0, y0, x1, y1, this.getPaint());
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.setFill();
    const rect = this.#ctx.canvasKit.XYWHRect(x, y, width, height);
    this.canvas.drawRect(rect, this.getPaint());
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.setStroke();
    const rect = this.#ctx.canvasKit.XYWHRect(x, y, width, height);
    this.canvas.drawRect(rect, this.getPaint());
  }

  fillCircle(x: number, y: number, radius: number): void {
    this.setFill();
    this.canvas.drawCircle(x, y, radius, this.getPaint());
  }

  strokeCircle(x: number, y: number, radius: number): void {
    this.setStroke();
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

  quadTo(cpx: number, cpy: number, x: number, y: number): void {
    this.#path.quadTo(cpx, cpy, x, y);
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

  constructPath(path: Path2D, nativePath: Path): Path {
    for (const command of path.commands) {
      switch (command.type) {
        case "moveTo":
          nativePath.moveTo(command.x, command.y);
          break;
        case "lineTo":
          nativePath.lineTo(command.x, command.y);
          break;
        case "cubicTo":
          nativePath.cubicTo(
            command.cp1x,
            command.cp1y,
            command.cp2x,
            command.cp2y,
            command.x,
            command.y,
          );
          break;
        case "close":
          nativePath.close();
          break;
      }
    }

    return nativePath;
  }

  stroke(path?: Path2D): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    this.setStrokeColour();
    this.setStroke();

    if (path) {
      let cachedPath = this.#cachedPaths.get(path);

      if (cachedPath) {
        if (path.invalidated) {
          cachedPath.reset();
          cachedPath = this.constructPath(path, cachedPath);
          this.#cachedPaths.set(path, cachedPath);
          path.invalidated = false;
        }

        this.canvas.drawPath(cachedPath, p);
        return;
      }

      const newPath = new this.ctx.canvasKit.Path();
      const nativePath = this.constructPath(path, newPath);
      this.#cachedPaths.set(path, nativePath);
      this.canvas.drawPath(nativePath, p);
      return;
    }

    this.canvas.drawPath(this.#path, p);
  }

  fill(path?: Path2D): void {
    const p = this.getPaint();
    p.setStyle(this.ctx.canvasKit.PaintStyle.Fill);
    this.setFillColour();
    this.setFill();

    if (path) {
      let cachedPath = this.#cachedPaths.get(path);

      if (cachedPath) {
        if (path.invalidated) {
          cachedPath.reset();
          cachedPath = this.constructPath(path, cachedPath);
          this.#cachedPaths.set(path, cachedPath);
          path.invalidated = false;

          this.canvas.drawPath(cachedPath, p);
          return;
        }

        this.canvas.drawPath(cachedPath, p);
        return;
      }

      const newPath = new this.ctx.canvasKit.Path();
      const nativePath = this.constructPath(path, newPath);
      this.#cachedPaths.set(path, nativePath);
      this.canvas.drawPath(nativePath, p);
      return;
    }

    this.canvas.drawPath(this.#path, p);
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
      alpha: 1,
      antialias: 1,
      depth: 0,
      premultipliedAlpha: 1,
      preserveDrawingBuffer: 1,
      stencil: 0,
    });

    this.#surface = s;

    if (s) {
      this.#canvas = s.getCanvas();
    }
  }

  public resizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio;
    const viewportRect = canvas.getBoundingClientRect();

    const width = Math.floor(viewportRect.width * dpr);
    const height = Math.floor(viewportRect.height * dpr);

    const editor = getEditor();
    editor.setViewportRect({
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
