import { Point } from "./point";
import { Shape } from "./shape";

export type Vertex = Point;

export type Vertices = [Vertex, Vertex, Vertex];

export class Triangle extends Shape {
  #vertices: Vertices;

  constructor(vertices: Vertices) {
    super(vertices[0].x, vertices[0].y);

    this.#vertices = vertices;
  }

  public get vertices(): Vertices {
    return this.#vertices;
  }
}
