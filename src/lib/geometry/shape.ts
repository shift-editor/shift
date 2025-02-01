import { Point } from "./point";

export abstract class Shape {
  #x: number;
  #y: number;
  #position: Point;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;

    this.#position = new Point(x, y);
  }

  get position(): Point {
    return this.#position;
  }

  set position(pos: Point) {
    this.#position.set_x(pos.x);
    this.#position.set_y(pos.y);
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  abstract hit(point: Point): boolean;
}
