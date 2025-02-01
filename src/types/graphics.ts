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
  drawPath(): void;

  stroke(): void;

  scale(x: number, y: number): void;
}

export interface IGraphicContext {
  createSurface(canvas: HTMLCanvasElement): void;
  recreateSurface(canvas: HTMLCanvasElement): void;

  getContext(): IRenderer;
}
