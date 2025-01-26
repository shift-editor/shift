import { Point } from "../geometry/point";

export class CanvasContext {
  #canvas: HTMLCanvasElement;

  public constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  getRelativePosition(e: MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    return new Point(x, y);
  }
}
