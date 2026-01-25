import type { Point2D } from "./types";

/**
 * 2D Affine Transformation Matrix (3x2 representation)
 *
 * Represents a 3x3 homogeneous matrix with implicit bottom row [0, 0, 1]:
 *
 * | a  c  e |
 * | b  d  f |
 * | 0  0  1 | (implicit)
 *
 * Supports: translation, rotation, scale, skew, reflection
 * Maps directly to Canvas2D transform(a, b, c, d, e, f)
 */
export interface MatModel {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export class Mat implements MatModel {
  a = 1.0;
  b = 0.0;
  c = 0.0;
  d = 1.0;
  e = 0.0;
  f = 0.0;

  constructor(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  multiply(m: MatModel): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * m.a + c * m.b;
    this.c = a * m.c + c * m.d;
    this.e = a * m.e + c * m.f + e;
    this.b = b * m.a + d * m.b;
    this.d = b * m.c + d * m.d;
    this.f = b * m.e + d * m.f + f;
    return this;
  }

  invert(): this {
    const { a, b, c, d, e, f } = this;
    const denom = a * d - b * c;

    if (denom === 0) {
      throw new Error("Cannot invert singular matrix");
    }

    this.a = d / denom;
    this.b = -b / denom;
    this.c = -c / denom;
    this.d = a / denom;
    this.e = (c * f - d * e) / denom;
    this.f = (b * e - a * f) / denom;
    return this;
  }

  translate(x: number, y: number): this {
    this.e += x;
    this.f += y;
    return this;
  }

  scale(sx: number, sy: number): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }

  rotate(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { a, b, c, d } = this;
    this.a = a * cos + c * sin;
    this.b = b * cos + d * sin;
    this.c = a * -sin + c * cos;
    this.d = b * -sin + d * cos;
    return this;
  }

  toCanvasTransform(): [number, number, number, number, number, number] {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  static Identity(): Mat {
    return new Mat(1, 0, 0, 1, 0, 0);
  }

  static Translate(x: number, y: number): Mat {
    return new Mat(1, 0, 0, 1, x, y);
  }

  static Scale(sx: number, sy: number): Mat {
    return new Mat(sx, 0, 0, sy, 0, 0);
  }

  static Rotate(angle: number): Mat {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Mat(cos, sin, -sin, cos, 0, 0);
  }

  static ReflectHorizontal(): Mat {
    return new Mat(1, 0, 0, -1, 0, 0);
  }

  static ReflectVertical(): Mat {
    return new Mat(-1, 0, 0, 1, 0, 0);
  }

  static ReflectAxis(angle: number): Mat {
    const cos2a = Math.cos(2 * angle);
    const sin2a = Math.sin(2 * angle);
    return new Mat(cos2a, sin2a, sin2a, -cos2a, 0, 0);
  }

  static Compose(m1: MatModel, m2: MatModel): Mat {
    return new Mat(
      m1.a * m2.a + m1.c * m2.b,
      m1.b * m2.a + m1.d * m2.b,
      m1.a * m2.c + m1.c * m2.d,
      m1.b * m2.c + m1.d * m2.d,
      m1.a * m2.e + m1.c * m2.f + m1.e,
      m1.b * m2.e + m1.d * m2.f + m1.f,
    );
  }

  static Inverse(m: MatModel): Mat {
    return new Mat(m.a, m.b, m.c, m.d, m.e, m.f).invert();
  }

  static applyToPoint(m: MatModel, point: Point2D): Point2D {
    return {
      x: m.a * point.x + m.c * point.y + m.e,
      y: m.b * point.x + m.d * point.y + m.f,
    };
  }

  clone(): Mat {
    return new Mat(this.a, this.b, this.c, this.d, this.e, this.f);
  }
}
