import { Point } from "../geometry/point";

export class CanvasManager {
  public constructor(private canvasRef: React.RefObject<HTMLCanvasElement>) {}

  get canvas(): HTMLCanvasElement {
    if (!this.canvasRef.current) {
      throw new Error("no canvas reference");
    }

    return this.canvasRef.current;
  }

  getRelativePosition(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    return new Point(x, y);
  }
}
