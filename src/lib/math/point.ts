export class Point {
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
  }

  clone(): Point {
    return new Point(this.#x, this.#y);
  }

  public static create(x: number, y: number): Point {
    return new Point(x, y);
  }

  public get x() {
    return this.#x;
  }

  public get y() {
    return this.#y;
  }

  public set_x(x: number) {
    this.#x = x;
  }

  public set_y(y: number) {
    this.#y = y;
  }

  public distance(x: number, y: number): number {
    return Math.hypot(this.#x - x, this.#y - y);
  }

  public static distance(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
  ): number {
    return Math.hypot(x1 - x0, y1 - y0);
  }

  public lerp(p: Point, t: number): Point {
    return new Point(
      Math.floor(this.#x + t * (p.x - this.#x)),
      Math.floor(this.#y + t * (p.y - this.#y)),
    );
  }
}
