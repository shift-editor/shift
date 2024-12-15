import { IRenderer } from "../../../../types/renderer";
import { Point } from "../../../geometry/point";
import { DrawStyle, HANDLE_STYLES, HandleType } from "../../styles/style";

export class Handle {
  constructor(
    private type: HandleType,
    private position: Point,
    private style: Partial<DrawStyle> = {}
  ) {
    this.style = style;
    this.type = type;
  }

  draw(renderer: IRenderer): void {
    let style;
    switch (this.type) {
      case HandleType.CORNER:
        style = { ...HANDLE_STYLES[HandleType.CORNER], ...this.style };
        renderer.drawRect(this.position.x, this.position.y, 5, 5, style);
        break;

      case HandleType.CONTROL:
        style = { ...HANDLE_STYLES[HandleType.CONTROL], ...this.style };
        renderer.drawCircle(this.position.x, this.position.y, 2.5, style);
        break;

      default:
        break;
    }
  }
}
