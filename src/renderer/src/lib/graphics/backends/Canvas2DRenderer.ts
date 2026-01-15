/**
 * Canvas 2D Renderer
 *
 * Native Canvas 2D API implementation of IRenderer.
 * Benefits over CanvasKit:
 * - No WASM loading
 * - Simpler debugging (native DevTools support)
 * - Smaller bundle size
 * - No WebGL context management
 */

import { DEFAULT_STYLES, DrawStyle } from "@/lib/styles/style";
import { getEditor } from "@/store/store";
import { IGraphicContext, IRenderer, IPath } from "@/types/graphics";
import { Path2D as ShiftPath2D } from "../Path";

// Native Canvas 2D Path wrapper implementing IPath
export class Canvas2DPath implements IPath {
  #path: Path2D;

  constructor() {
    this.#path = new Path2D();
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
    y: number
  ): void {
    this.#path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  quadTo(cpx: number, cpy: number, x: number, y: number): void {
    this.#path.quadraticCurveTo(cpx, cpy, x, y);
  }

  arcTo(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    isCounterClockwise?: boolean
  ): void {
    this.#path.arc(x, y, radius, startAngle, endAngle, isCounterClockwise);
  }

  closePath(): void {
    this.#path.closePath();
  }

  _getNativePath(): Path2D {
    return this.#path;
  }
}

export class Canvas2DRenderer implements IRenderer {
  #ctx: Canvas2DContext;
  #renderCtx: CanvasRenderingContext2D;
  #currentStyle: DrawStyle = { ...DEFAULT_STYLES };
  #path: Path2D;

  // Cache for converting ShiftPath2D to native Path2D
  #cachedPaths: Map<ShiftPath2D, Path2D> = new Map();

  public constructor(ctx: Canvas2DContext) {
    this.#ctx = ctx;
    this.#renderCtx = ctx.renderContext;
    this.#path = new Path2D();
  }

  public get ctx(): Canvas2DContext {
    return this.#ctx;
  }

  public get renderContext(): CanvasRenderingContext2D {
    return this.#renderCtx;
  }

  public setStyle(style: DrawStyle): void {
    this.#currentStyle = { ...style };
    this.strokeStyle = style.strokeStyle;
    this.fillStyle = style.fillStyle;
    this.lineWidth = style.lineWidth;
    if (style.dashPattern) {
      this.dashPattern = style.dashPattern;
    }
  }

  public get lineWidth(): number {
    return this.#currentStyle.lineWidth;
  }

  public set lineWidth(width: number) {
    this.#currentStyle.lineWidth = width;
    this.#renderCtx.lineWidth = width;
  }

  public get strokeStyle(): string {
    return this.#currentStyle.strokeStyle;
  }

  public set strokeStyle(style: string) {
    this.#currentStyle.strokeStyle = style;
    this.#renderCtx.strokeStyle = style;
  }

  public get fillStyle(): string {
    return this.#currentStyle.fillStyle;
  }

  public set fillStyle(style: string) {
    this.#currentStyle.fillStyle = style;
    this.#renderCtx.fillStyle = style;
  }

  public get antiAlias(): boolean {
    return this.#currentStyle.antiAlias ?? true;
  }

  public set antiAlias(value: boolean) {
    this.#currentStyle.antiAlias = value;
    // Canvas 2D uses imageSmoothingEnabled for images,
    // but line rendering antialiasing is not controllable
    this.#renderCtx.imageSmoothingEnabled = value;
  }

  public get dashPattern(): number[] {
    return this.#currentStyle.dashPattern;
  }

  public set dashPattern(pattern: number[]) {
    this.#currentStyle.dashPattern = pattern;
    this.#renderCtx.setLineDash(pattern);
  }

  // Apply current style to context before drawing
  #applyStrokeStyle(): void {
    this.#renderCtx.strokeStyle = this.#currentStyle.strokeStyle;
    this.#renderCtx.lineWidth = this.#currentStyle.lineWidth;
    this.#renderCtx.setLineDash(this.#currentStyle.dashPattern);
  }

  #applyFillStyle(): void {
    this.#renderCtx.fillStyle = this.#currentStyle.fillStyle;
  }

  save(): void {
    this.#renderCtx.save();
  }

  restore(): void {
    this.#renderCtx.restore();
  }

  flush(): void {
    // Canvas 2D doesn't need explicit flushing - operations are immediate
    // This is a no-op for API compatibility
  }

  clear(): void {
    const canvas = this.#renderCtx.canvas;
    this.#renderCtx.clearRect(0, 0, canvas.width, canvas.height);
  }

  dispose(): void {
    this.#cachedPaths.clear();
  }

  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    this.#applyStrokeStyle();
    this.#renderCtx.beginPath();
    this.#renderCtx.moveTo(x0, y0);
    this.#renderCtx.lineTo(x1, y1);
    this.#renderCtx.stroke();
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.#applyFillStyle();
    this.#renderCtx.fillRect(x, y, width, height);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.#applyStrokeStyle();
    this.#renderCtx.strokeRect(x, y, width, height);
  }

  fillCircle(x: number, y: number, radius: number): void {
    this.#applyFillStyle();
    this.#renderCtx.beginPath();
    this.#renderCtx.arc(x, y, radius, 0, Math.PI * 2);
    this.#renderCtx.fill();
  }

  strokeCircle(x: number, y: number, radius: number): void {
    this.#applyStrokeStyle();
    this.#renderCtx.beginPath();
    this.#renderCtx.arc(x, y, radius, 0, Math.PI * 2);
    this.#renderCtx.stroke();
  }

  createPath(): IPath {
    return new Canvas2DPath();
  }

  beginPath(): void {
    this.#path = new Path2D();
  }

  moveTo(x: number, y: number): void {
    this.#path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.#path.lineTo(x, y);
  }

  quadTo(cpx: number, cpy: number, x: number, y: number): void {
    this.#path.quadraticCurveTo(cpx, cpy, x, y);
  }

  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number
  ): void {
    this.#path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, x, y);
  }

  arcTo(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    isCounterClockwise?: boolean
  ): void {
    this.#path.arc(x, y, radius, startAngle, endAngle, isCounterClockwise);
  }

  closePath(): void {
    this.#path.closePath();
  }

  // Convert ShiftPath2D commands to native Path2D
  #constructPath(path: ShiftPath2D): Path2D {
    const nativePath = new Path2D();

    for (const command of path.commands) {
      switch (command.type) {
        case "moveTo":
          nativePath.moveTo(command.x, command.y);
          break;
        case "lineTo":
          nativePath.lineTo(command.x, command.y);
          break;
        case "quadTo":
          nativePath.quadraticCurveTo(
            command.cp1x,
            command.cp1y,
            command.x,
            command.y
          );
          break;
        case "cubicTo":
          nativePath.bezierCurveTo(
            command.cp1x,
            command.cp1y,
            command.cp2x,
            command.cp2y,
            command.x,
            command.y
          );
          break;
        case "close":
          nativePath.closePath();
          break;
      }
    }

    return nativePath;
  }

  stroke(path?: ShiftPath2D | IPath): void {
    this.#applyStrokeStyle();

    if (path) {
      if (path instanceof ShiftPath2D) {
        // Handle ShiftPath2D with caching
        let cachedPath = this.#cachedPaths.get(path);

        if (cachedPath && !path.invalidated) {
          this.#renderCtx.stroke(cachedPath);
          return;
        }

        // Rebuild path
        cachedPath = this.#constructPath(path);
        this.#cachedPaths.set(path, cachedPath);
        path.invalidated = false;
        this.#renderCtx.stroke(cachedPath);
        return;
      }

      // Handle IPath (Canvas2DPath)
      if (path instanceof Canvas2DPath) {
        this.#renderCtx.stroke(path._getNativePath());
        return;
      }
    }

    // Stroke current path
    this.#renderCtx.stroke(this.#path);
  }

  fill(path?: ShiftPath2D | IPath): void {
    this.#applyFillStyle();

    if (path) {
      if (path instanceof ShiftPath2D) {
        // Handle ShiftPath2D with caching
        let cachedPath = this.#cachedPaths.get(path);

        if (cachedPath && !path.invalidated) {
          this.#renderCtx.fill(cachedPath);
          return;
        }

        // Rebuild path
        cachedPath = this.#constructPath(path);
        this.#cachedPaths.set(path, cachedPath);
        path.invalidated = false;
        this.#renderCtx.fill(cachedPath);
        return;
      }

      // Handle IPath (Canvas2DPath)
      if (path instanceof Canvas2DPath) {
        this.#renderCtx.fill(path._getNativePath());
        return;
      }
    }

    // Fill current path
    this.#renderCtx.fill(this.#path);
  }

  scale(x: number, y: number): void {
    this.#renderCtx.scale(x, y);
  }

  translate(x: number, y: number): void {
    this.#renderCtx.translate(x, y);
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): void {
    // Canvas 2D transform uses the same matrix format
    this.#renderCtx.transform(a, b, c, d, e, f);
  }
}

export class Canvas2DContext implements IGraphicContext {
  #renderCtx: CanvasRenderingContext2D | null = null;
  #renderer: Canvas2DRenderer | null = null;

  public constructor() {}

  public get renderContext(): CanvasRenderingContext2D {
    if (!this.#renderCtx) {
      throw new Error("Canvas context not initialized");
    }
    return this.#renderCtx;
  }

  public getContext(): Canvas2DRenderer {
    if (!this.#renderer) {
      throw new Error("Renderer not initialized");
    }
    return this.#renderer;
  }

  public createSurface(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }

    this.#renderCtx = ctx;
    this.#renderer = new Canvas2DRenderer(this);
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
    this.#renderCtx!.scale(dpr, dpr);
  }

  public dispose(): void {
    if (this.#renderer) {
      this.#renderer.dispose();
    }
  }

  public destroy(): void {
    this.dispose();
    this.#renderCtx = null;
    this.#renderer = null;
  }
}
