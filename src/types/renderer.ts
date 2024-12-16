import { DrawStyle } from "../lib/graphics/styles/style";

export interface IRenderer {
  flush(): void;

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style?: Partial<DrawStyle>
  ): void;
  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    style?: Partial<DrawStyle>
  ): void;
  drawCircle(
    x: number,
    y: number,
    radius: number,
    style?: Partial<DrawStyle>
  ): void;

  beginPath(): void;
  moveTo(x: number, y: number): void;

  lineTo(x: number, y: number): void;
  cubicTo(
    cpx1: number,
    cpy1: number,
    cpx2: number,
    cpy2: number,
    x: number,
    y: number
  ): void;

  close(): void;
  drawPath(style?: Partial<DrawStyle>): void;

  stroke(): void;
}
