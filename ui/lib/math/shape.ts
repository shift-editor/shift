import { Point } from "./point";

export abstract class Shape {
  #position: Point;

  constructor(x: number, y: number) {
    this.#position = new Point(x, y);
  }

  get position(): Point {
    return this.#position;
  }

  get x(): number {
    return this.#position.x;
  }

  get y(): number {
    return this.#position.y;
  }

  abstract hit(x: number, y: number): boolean;
}
