import { Point2D, Rect2D } from "@/types/math";

import { Point } from "./point";
import { Shape } from "./shape";

export class Rect extends Shape {
  #width: number;
  #height: number;

  constructor(x: number, y: number, width: number, height: number) {
    super(x, y);
    this.#width = width;
    this.#height = height;
  }

  public static fromBounds(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): Rect {
    // TODO: check that it's a valid rectangle
    return new Rect(left, top, right - left, bottom - top);
  }

  public get_rect(): [number, number, number, number] {
    return [this.x, this.y, this.width, this.height];
  }

  public get_centered_position(): Point {
    return new Point(this.x - this.width / 2, this.y - this.height / 2);
  }

  // **
  // Resize the rectangle
  // @param width - The new width of the rectangle
  // @param height - The new height of the rectangle
  // **
  public resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  get left(): number {
    return this.x;
  }

  get top(): number {
    return this.y;
  }

  get right(): number {
    return this.left + this.width;
  }

  get bottom(): number {
    return this.top + this.height;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  hit(x: number, y: number): boolean {
    return (
      this.x <= x &&
      x <= this.x + this.width &&
      this.y <= y &&
      y <= this.y + this.#height
    );
  }
}

export function getBoundingRectPoints(points: Point[]): Rect2D {
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
  };
}
