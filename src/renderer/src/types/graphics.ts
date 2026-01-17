import type { DrawStyle } from "@/lib/styles/style";

export type PathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | {
      type: "cubicTo";
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  | { type: "quadTo"; cp1x: number; cp1y: number; x: number; y: number }
  | { type: "close" };

export type Colour = [number, number, number, number];

export interface IPath {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export interface IRenderer {
  save(): void;
  restore(): void;
  clear(): void;

  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias: boolean;
  dashPattern: number[];

  setStyle(style: DrawStyle): void;

  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillCircle(x: number, y: number, radius: number): void;
  strokeCircle(x: number, y: number, radius: number): void;
  createPath(): IPath;
  beginPath(): void;
  moveTo(x: number, y: number): void;

  lineTo(x: number, y: number): void;
  quadTo(cpx: number, cpy: number, x: number, y: number): void;
  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number
  ): void;
  arcTo(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    isCounterClockwise?: boolean
  ): void;

  closePath(): void;

  stroke(): void;
  fill(): void;

  scale(x: number, y: number): void;
  translate(x: number, y: number): void;

  /**
   * @param a - The scale factor for the x-axis
   * @param b - The shear factor for the x-axis
   * @param c - The shear factor for the y-axis
   * @param d - The scale factor for the y-axis
   * @param e - The x-axis translation
   * @param f - The y-axis translation
   */
  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): void;
}

export interface IGraphicContext {
  resizeCanvas(canvas: HTMLCanvasElement, rect: DOMRectReadOnly): void;

  getContext(): IRenderer;

  destroy(): void;
}

export type CanvasRef = React.RefObject<HTMLCanvasElement | null>;
export type GraphicsContextRef = React.RefObject<IGraphicContext | null>;
