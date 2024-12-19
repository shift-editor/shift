import { IRenderer } from "../../../types/renderer";
import { Path } from "../../geometry/path";

export class PathRenderer {
  #renderer: IRenderer;
  constructor(renderer: IRenderer) {
    this.#renderer = renderer;
  }

  render(path: Path): void {
    const segments = path.segments;
    this.#renderer.beginPath();

    for (let idx = 0; idx <= segments.length - 1; idx++) {
      const currSegment = segments[idx];
      if (idx == 0) {
        this.#renderer.moveTo(
          currSegment.startPoint.x,
          currSegment.startPoint.y
        );
        continue;
      }

      this.#renderer.lineTo(currSegment.endPoint.x, currSegment.endPoint.y);
    }
    this.#renderer.drawPath();
  }
}
