import { DrawStyle } from "../lib/graphics/styles/style";

export interface IRenderer {
  drawLine(
    x: number,
    y: number,
    width: number,
    height: number,
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

  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  close(): void;
  stroke(): void;
}
