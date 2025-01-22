import { Point } from "../geometry/point";

export class CanvasManager {
  #canvas: HTMLCanvasElement;
  public constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  getRelativePosition(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    return new Point(x, y);
  }
}
