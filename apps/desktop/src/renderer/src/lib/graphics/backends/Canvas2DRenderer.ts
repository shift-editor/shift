/**
 * Canvas 2D Renderer
 *
 * Native Canvas 2D API implementation of IRenderer.
 * Uses immediate mode rendering - no path caching.
 */

import { DEFAULT_STYLES, DrawStyle } from "@/lib/styles/style";
import { getEditor } from "@/store/store";
import { IGraphicContext, IRenderer, IPath } from "@/types/graphics";

export class Canvas2DRenderer implements IRenderer {
  #ctx: Canvas2DContext;
  #renderCtx: CanvasRenderingContext2D;
  #currentStyle: DrawStyle = { ...DEFAULT_STYLES };
  #path: Path2D;

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
    this.#renderCtx.setLineDash(this.#normalizeDashPattern(pattern));
  }

  #normalizeDashPattern(pattern: number[]): number[] {
    if (pattern.length === 0) return pattern;
    const zoom = getEditor().getZoom();
    return pattern.map((v) => v / zoom);
  }

  #applyStrokeStyle(): void {
    this.#renderCtx.strokeStyle = this.#currentStyle.strokeStyle;
    this.#renderCtx.lineWidth = this.#currentStyle.lineWidth;
    this.#renderCtx.setLineDash(this.#normalizeDashPattern(this.#currentStyle.dashPattern));
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

  clear(): void {
    const canvas = this.#renderCtx.canvas;
    this.#renderCtx.clearRect(0, 0, canvas.width, canvas.height);
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
    throw new Error("createPath is not supported - use immediate mode rendering");
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

  cubicTo(cpx1: number, cpy1: number, cpx2: number, cpy2: number, x: number, y: number): void {
    this.#path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, x, y);
  }

  arcTo(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    isCounterClockwise?: boolean,
  ): void {
    this.#path.arc(x, y, radius, startAngle, endAngle, isCounterClockwise);
  }

  closePath(): void {
    this.#path.closePath();
  }

  stroke(): void {
    this.#applyStrokeStyle();
    this.#renderCtx.stroke(this.#path);
  }

  fill(): void {
    this.#applyFillStyle();
    this.#renderCtx.fill(this.#path);
  }

  fillPath(path: Path2D): void {
    this.#applyFillStyle();
    this.#renderCtx.fill(path);
  }

  strokePath(path: Path2D): void {
    this.#applyStrokeStyle();
    this.#renderCtx.stroke(path);
  }

  scale(x: number, y: number): void {
    this.#renderCtx.scale(x, y);
  }

  translate(x: number, y: number): void {
    this.#renderCtx.translate(x, y);
  }

  rotate(angle: number): void {
    this.#renderCtx.rotate(angle);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
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

  public destroy(): void {
    this.#renderCtx = null;
    this.#renderer = null;
  }
}
