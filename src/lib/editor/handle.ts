import { IRenderer } from "../../types/renderer";
import { Point } from "../geometry/point";
import { DrawStyle, HANDLE_STYLES } from "../graphics/styles/style";

export enum HandleType {
  CORNER,
  SMOOTH,
  CONTROL,
  DIRECTION,
}

const handleDimensions = {
  [HandleType.CORNER]: { width: 5, height: 5 },
  [HandleType.CONTROL]: { radius: 2.5 },
  [HandleType.SMOOTH]: { radius: 2.5 },
};

export class Handle {
  #type: HandleType;
  #position: Point;
  #style: Partial<DrawStyle>;

  constructor(
    type: HandleType,
    position: Point,
    style: Partial<DrawStyle> = {}
  ) {
    this.#position = position;
    this.#type = type;
    this.#style = style;
  }

  get position(): Point {
    return this.#position;
  }

  set position(point: Point) {
    this.#position = point;
  }

  draw(renderer: IRenderer): void {
    let style;
    switch (this.#type) {
      case HandleType.CORNER:
        style = { ...HANDLE_STYLES[HandleType.CORNER], ...this.#style };

        renderer.drawRect(
          this.#position.x - handleDimensions[this.#type].width / 2,
          this.#position.y - handleDimensions[this.#type].height / 2,
          5,
          5,
          style
        );
        break;

      case HandleType.SMOOTH:
        style = { ...HANDLE_STYLES[HandleType.SMOOTH], ...this.#style };
        renderer.drawCircle(
          this.#position.x,
          this.#position.y,
          handleDimensions[this.#type].radius,
          style
        );
        break;

      case HandleType.CONTROL:
        style = { ...HANDLE_STYLES[HandleType.CONTROL], ...this.#style };

        renderer.drawCircle(this.#position.x, this.#position.y, 2.5, style);
        break;

      case HandleType.DIRECTION:
        style = { ...HANDLE_STYLES[HandleType.DIRECTION], ...this.#style };
        renderer.beginPath();
        renderer.moveTo(this.#position.x, this.#position.y); // tip
        renderer.lineTo(this.#position.x - 4, this.#position.y + 6); // left
        renderer.lineTo(this.#position.x + 4, this.#position.y + 6); // right
        renderer.close();
        renderer.drawPath(style);
        break;
      default:
        break;
    }
  }
}
