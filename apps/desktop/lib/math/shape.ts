import { Point } from './point';

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

  static shoelace(points: Point[]): number {
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
