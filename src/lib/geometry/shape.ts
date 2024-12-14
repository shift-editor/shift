import { Point } from "./point";

export abstract class Shape {
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
  }

  getPosition(): Point {
    return new Point(this.x, this.y);
  }

  setPosition(x: number, y: number): void {
    this.#x = x;
    this.#y = y;
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }
}
