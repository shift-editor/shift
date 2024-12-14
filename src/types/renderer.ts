export interface IRenderer {
  // Primitive operations
  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  drawRect(x: number, y: number, width: number, height: number): void;
  drawCircle(x: number, y: number, radius: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  close(): void;
}
