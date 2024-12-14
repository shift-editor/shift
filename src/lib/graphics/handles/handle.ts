import { IRenderer } from "../../../types/renderer";
import { HandleStyle, HandleType } from "./types";

export class Handle {
  constructor(private type: HandleType, private style?: Partial<HandleStyle>) {
    this.style = {};
  }

  draw(renderer: IRenderer): void {
    switch (this.type) {
      case HandleType.Corner:
        renderer.drawRect(10, 10, 10, 10);
        break;

      default:
        break;
    }
  }

  // draw methods
}
