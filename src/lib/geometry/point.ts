export class Point {
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
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

  public set set_x(x: number) {
    this.#x = x;
  }

  public set set_y(y: number) {
    this.#y = y;
  }
}
