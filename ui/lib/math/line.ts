import { Point2D } from '@/types/math';

import { Point } from './point';

export class Line {
  #x0: number;
  #x1: number;

  #y0: number;
  #y1: number;

  #startPoint: Point;
  #endPoint: Point;

  #length: number;

  constructor(x0: number, x1: number, y0: number, y1: number) {
    this.#x0 = x0;
    this.#y0 = y0;

    this.#x1 = x1;
    this.#y1 = y1;

    this.#startPoint = new Point(x0, y0);
    this.#endPoint = new Point(x1, y1);

    this.#length = Math.sqrt(Math.pow(this.#x1 - this.#x0, 2) + Math.pow(this.#y0 - this.#y1, 2));
  }

  get startPoint(): Point {
    return this.#startPoint;
  }

  get endPoint(): Point {
    return this.#endPoint;
  }

  get length(): number {
    return this.#length;
  }

  static lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };
  }
}
