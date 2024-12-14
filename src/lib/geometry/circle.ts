import { Shape } from "./shape";

export class Circle extends Shape {
  #radius: number;

  constructor(x: number, y: number, radius: number) {
    super(x, y);
    this.#radius = radius;
  }

  public get radius(): number {
    return this.#radius;
  }
}
