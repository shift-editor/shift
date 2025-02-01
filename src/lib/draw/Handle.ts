import { IRenderer } from "../../types/graphics";
import { HandleType } from "../../types/handle";
import { Circle } from "../geometry/circle";
import { Point } from "../geometry/point";
import { Rect } from "../geometry/rect";
import { Shape } from "../geometry/shape";
import { Triangle } from "../geometry/triangle";
import { DrawStyle, HANDLE_STYLES } from "./styles/style";

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
  #selected: boolean = false;
  #type: HandleType;
  #position: Point;
  #style: Partial<DrawStyle>;
  #shape: Shape;

  constructor(
    position: Point,
    type: HandleType,
    style: Partial<DrawStyle> = {},
  ) {
    this.#position = position;
    this.#type = type;
    this.#style = style;

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
    let style;
    switch (this.#type) {
      case HandleType.CORNER:
        const rect = this.#shape as Rect;
        renderer.drawRect(
          this.#position.x - rect.width / 2,
          this.#position.y - rect.height / 2,
          5,
          5,
          style,
        );
        break;

      case HandleType.SMOOTH:
        const circleSmooth = this.#shape as Circle;
        style = { ...HANDLE_STYLES[this.#type], ...this.#style };
        renderer.drawCircle(
          this.#position.x,
          this.#position.y,
          circleSmooth.radius,
          style,
        );
        break;

      case HandleType.CONTROL:
        const circleControl = this.#shape as Circle;
        style = { ...HANDLE_STYLES[this.#type], ...this.#style };
        renderer.drawCircle(
          this.#position.x,
          this.#position.y,
          circleControl.radius,
          style,
        );
        break;

      case HandleType.DIRECTION:
        const triangle = this.#shape as Triangle;
        style = { ...HANDLE_STYLES[HandleType.DIRECTION], ...this.#style };

        renderer.beginPath();
        renderer.moveTo(triangle.vertices[0].x, triangle.vertices[0].x); // tip
        renderer.lineTo(triangle.vertices[1].x, triangle.vertices[1].x); // left
        renderer.lineTo(triangle.vertices[2].x, triangle.vertices[2].x); // left
        renderer.close();
        renderer.drawPath(style);

        break;
      default:
        break;
    }
  }
}
