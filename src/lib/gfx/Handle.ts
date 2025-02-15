import { IRenderer } from "../../types/graphics";
import { HandleType } from "../../types/handle";
import { Circle } from "../geometry/circle";
import { Point } from "../geometry/point";
import { Rect } from "../geometry/rect";
import { Shape } from "../geometry/shape";
import { Triangle } from "../geometry/triangle";

const handleShape = {
  [HandleType.CORNER]: (p: Point) => new Rect(p.x, p.y, 5, 5),
  [HandleType.CONTROL]: (p: Point) => new Circle(p.x, p.y, 2.5),
  [HandleType.SMOOTH]: (p: Point) => new Circle(p.x, p.y, 2.5),
  [HandleType.DIRECTION]: (p: Point) =>
    new Triangle([
      new Point(p.x, p.y),
      new Point(p.x - 4, p.y + 6),
      new Point(p.x + 4, p.y + 6),
    ]),
};

export class Handle {
  #type: HandleType;
  #position: Point;
  #shape: Shape;

  constructor(position: Point, type: HandleType) {
    this.#position = position;
    this.#type = type;

    this.#shape = handleShape[type](position);
  }

  get selected(): boolean {
    return this.selected;
  }

  set selected(select: boolean) {
    this.selected = select;
  }

  get position(): Point {
    return this.#position;
  }

  set position(point: Point) {
    this.#position = point;
  }

  hit(p: Point): boolean {
    return this.#shape.hit(p);
  }

  draw(renderer: IRenderer): void {
    let rect;
    let circle;
    let triangle;

    switch (this.#type) {
      case HandleType.CORNER:
        rect = this.#shape as Rect;
        renderer.strokeRect(
          this.#position.x - rect.width / 2,
          this.#position.y - rect.height / 2,
          5,
          5,
        );
        break;

      case HandleType.SMOOTH:
        circle = this.#shape as Circle;
        renderer.strokeCircle(
          this.#position.x,
          this.#position.y,
          circle.radius,
        );
        break;

      case HandleType.CONTROL:
        circle = this.#shape as Circle;
        renderer.strokeCircle(
          this.#position.x,
          this.#position.y,
          circle.radius,
        );
        break;

      case HandleType.DIRECTION:
        triangle = this.#shape as Triangle;

        renderer.beginPath();
        renderer.moveTo(triangle.vertices[0].x, triangle.vertices[0].x); // tip
        renderer.lineTo(triangle.vertices[1].x, triangle.vertices[1].x); // left
        renderer.lineTo(triangle.vertices[2].x, triangle.vertices[2].x); // left
        renderer.closePath();
        renderer.stroke();

        break;
      default:
        break;
    }
  }
}
