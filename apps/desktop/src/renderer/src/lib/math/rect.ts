import type { Point2D, Rect2D } from "@shift/types";

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
    return new Rect(left, top, right - left, bottom - top);
  }

  public get_rect(): [number, number, number, number] {
    return [this.x, this.y, this.width, this.height];
  }

  public get_centered_position(): Point2D {
    return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
  }

  public resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  public changeOrigin(x: number, y: number): void {
    this.setX(x);
    this.setY(y);
  }

  public clear(): void {
    this.#height = 0;
    this.#width = 0;
    this.setX(0);
    this.setY(0);
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

export class UPMRect extends Rect {
  constructor(x: number, y: number, width: number, height: number) {
    super(x, y, width, height);
  }

  public resize(width: number, height: number) {
    if (width < 0) {
      this.setX(this.x + width);
    }

    if (height < 0) {
      this.setY(this.y + height);
    }

    super.resize(Math.abs(width), Math.abs(height));
  }
}

export class UPMBoundingRect extends Rect {
  constructor(points: Point2D[]) {
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));

    super(minX, minY, maxX - minX, maxY - minY);
  }
}

export function getBoundingRect(points: Point2D[]): Rect2D {
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
