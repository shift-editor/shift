export class Vector2D {
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
  }

  static from(x0: number, y0: number, x1: number, y1: number) {
    return new Vector2D(x1 - x0, y1 - y0);
  }

  static unitFrom(x0: number, y0: number, x1: number, y1: number) {
    const v = Vector2D.from(x0, y0, x1, y1);
    const length = v.length();
    return new Vector2D(v.#x / length, v.#y / length);
  }

  get x() {
    return this.#x;
  }

  get y() {
    return this.#y;
  }

  length() {
    return Math.hypot(this.#x, this.#y);
  }

  reverse() {
    return new Vector2D(-this.#x, -this.#y);
  }

  add(vector: Vector2D) {
    return new Vector2D(this.#x + vector.#x, this.#y + vector.#y);
  }

  subtract(vector: Vector2D) {
    return new Vector2D(this.#x - vector.#x, this.#y - vector.#y);
  }

  multiply(scalar: number) {
    return new Vector2D(this.#x * scalar, this.#y * scalar);
  }

  divide(scalar: number) {
    return new Vector2D(this.#x / scalar, this.#y / scalar);
  }

  dot(vector: Vector2D) {
    return this.#x * vector.#x + this.#y * vector.#y;
  }

  cross(vector: Vector2D) {
    return this.#x * vector.#y - this.#y * vector.#x;
  }

  normalize() {
    const length = this.length();
    return new Vector2D(this.#x / length, this.#y / length);
  }
}
