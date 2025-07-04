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

  /**
   * Creates a new vector by adding a delta to an existing point
   * @param point The original point coordinates
   * @param delta The delta to add
   * @returns A new vector representing the new position
   */
  static fromDelta(x1: number, y1: number, dx: number, dy: number) {
    return new Vector2D(x1 + dx, y1 + dy);
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

  /**
   * Projects this vector onto another vector
   * @param vector The vector to project onto
   * @returns The projection of this vector onto the given vector
   */
  project(vector: Vector2D) {
    const dotProduct = this.dot(vector);
    const vectorLengthSquared = vector.#x * vector.#x + vector.#y * vector.#y;
    const scalar = dotProduct / vectorLengthSquared;
    return new Vector2D(vector.#x * scalar, vector.#y * scalar);
  }

  /**
   * Projects this vector onto another vector, always in the positive direction
   * @param vector The vector to project onto
   * @returns The projection of this vector onto the given vector (always positive)
   */
  projectAbsolute(vector: Vector2D) {
    const dotProduct = this.dot(vector);
    const vectorLengthSquared = vector.#x * vector.#x + vector.#y * vector.#y;
    const scalar = Math.abs(dotProduct) / vectorLengthSquared;
    return new Vector2D(vector.#x * scalar, vector.#y * scalar);
  }

  /**
   * Projects this vector onto a line defined by two points
   * @param lineStart The start point of the line
   * @param lineEnd The end point of the line
   * @returns The projection of this vector onto the line
   */
  projectOntoLine(lineStart: Vector2D, lineEnd: Vector2D) {
    const lineVector = lineEnd.subtract(lineStart);
    const pointVector = this.subtract(lineStart);
    const projection = pointVector.project(lineVector);
    return lineStart.add(projection);
  }

  /**
   * Returns the perpendicular component of this vector relative to another vector
   * @param vector The vector to get the perpendicular component relative to
   * @returns The perpendicular component
   */
  perpendicular(vector: Vector2D) {
    const projection = this.project(vector);
    return this.subtract(projection);
  }
}
