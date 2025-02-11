export interface Path2D {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export interface IRenderer {
  save(): void;
  restore(): void;
  flush(): void;
  clear(): void;
  dispose(): void;

  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;

  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  drawRect(x: number, y: number, width: number, height: number): void;
  drawCircle(x: number, y: number, radius: number): void;

  beginPath(): void;
  moveTo(x: number, y: number): void;

  lineTo(x: number, y: number): void;
  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number,
  ): void;

  close(): void;

  stroke(path?: Path2D): void;
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
    f: number,
  ): void;
}

export interface IGraphicContext {
  resizeCanvas(canvas: HTMLCanvasElement): void;

  getContext(): IRenderer;

  destroy(): void;
}

export type CanvasRef = React.RefObject<HTMLCanvasElement | null>;
export type GraphicsContextRef = React.RefObject<IGraphicContext | null>;
