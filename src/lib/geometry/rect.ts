import { Shape } from "./shape";

export class Rect extends Shape {
  #width: number;
  #height: number;

  constructor(x: number, y: number, width: number, height: number) {
    super(x, y);
    this.#width = width;
    this.#height = height;
  }

  public static fromBounds(
    left: number,
    top: number,
    right: number,
    bottom: number
  ): Rect {
    // TODO: check that it's a valid rectangle
    return new Rect(left, top, right - left, bottom - top);
  }

  public get_rect(): [number, number, number, number] {
    return [this.x, this.y, this.width, this.height];
  }

  get left(): number {
    return this.x;
  }

  get top(): number {
    return this.y;
  }

  get right(): number {
    return this.left + this.width;
  }

  get bottom(): number {
    return this.top + this.height;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }
}
