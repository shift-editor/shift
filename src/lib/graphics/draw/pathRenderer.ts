import { IRenderer } from "../../../types/renderer";
import { Path } from "../../geometry/path";
import { Point } from "../../geometry/point";
import { SegmentType } from "../../geometry/segment";
import { Handle, HandleType } from "../editor/handle";

export class PathRenderer {
  #renderer: IRenderer;
  constructor(renderer: IRenderer) {
    this.#renderer = renderer;
  }

  render(path: Path): void {
    const segments = path.segments;
    this.#renderer.beginPath();

    const cornerHandle = new Handle(HandleType.CORNER, new Point(0, 0));
    this.#renderer.moveTo(segments[0].startPoint.x, segments[0].startPoint.y);
    if (segments.length == 1 && segments[0].incompleteSegment()) {
      cornerHandle.position = segments[0].startPoint;
      cornerHandle.draw(this.#renderer);
      return;
    }

    for (let idx = 0; idx <= segments.length - 1; idx++) {
      const currSegment = segments[idx];
      switch (currSegment.type) {
        case SegmentType.Line:
          this.#renderer.lineTo(currSegment.endPoint.x, currSegment.endPoint.y);
          break;
        case SegmentType.Bezier:
          this.#renderer.cubicTo(
            currSegment.controlPoints[0].x,
            currSegment.controlPoints[0].y,
            currSegment.controlPoints[1].x,
            currSegment.controlPoints[1].y,
            currSegment.endPoint.x,
            currSegment.endPoint.y
          );
      }
    }
    this.#renderer.drawPath();

    const control = new Handle(HandleType.CONTROL, new Point(0, 0));
    for (let idx = 0; idx <= segments.length - 1; idx++) {
      const currSegment = segments[idx];
      cornerHandle.position = currSegment.endPoint;
      cornerHandle.draw(this.#renderer);

      if (currSegment.type == SegmentType.Bezier) {
        control.position = currSegment.controlPoints[0];
        this.#renderer.beginPath();
        this.#renderer.moveTo(
          currSegment.startPoint.x,
          currSegment.startPoint.y
        );
        this.#renderer.lineTo(control.position.x, control.position.y);
        this.#renderer.close();
        this.#renderer.drawPath();

        control.draw(this.#renderer);

        control.position = currSegment.controlPoints[1];
        this.#renderer.beginPath();
        this.#renderer.moveTo(currSegment.endPoint.x, currSegment.endPoint.y);
        this.#renderer.lineTo(control.position.x, control.position.y);
        this.#renderer.close();
        this.#renderer.drawPath();
        control.draw(this.#renderer);
      }
    }
  }
}
