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

  public reposition(x: number, y: number) {
    this.#x = x;
    this.#y = y;

    this.#position.set_x(x);
    this.#position.set_y(y);
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  abstract hit(x: number, y: number): boolean;
}
