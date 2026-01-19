import type { Point2D } from "@/types/math";

export abstract class Shape {
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  protected setX(x: number): void {
    this.#x = x;
  }

  protected setY(y: number): void {
    this.#y = y;
  }

  /**
   * Calculate the signed area of a polygon using the shoelace formula.
   * Positive for counter-clockwise, negative for clockwise.
   */
  static shoelace(points: Point2D[]): number {
    const n = points.length;
    let area = 0;

    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      area += p1.x * p2.y - p2.x * p1.y;
    }

    return area / 2;
  }

  abstract hit(x: number, y: number): boolean;
}
