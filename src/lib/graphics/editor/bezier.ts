import { IRenderer } from "../../../types/renderer";
import { Point } from "../../geometry/point";
import { Handle, HandleType } from "./handle";

export class BezierEditor {
  private start: Handle;
  private end: Handle;
  private control1: Handle;
  private control2: Handle;

  constructor() {
    // Initialize with some default positions
    this.start = new Handle(HandleType.CORNER, Point.create(100, 100));
    this.end = new Handle(HandleType.CORNER, Point.create(300, 100));
    this.control1 = new Handle(HandleType.CONTROL, Point.create(150, 50));
    this.control2 = new Handle(HandleType.CONTROL, Point.create(250, 50));
  }

  draw(renderer: IRenderer): void {
    renderer.drawLine(
      this.control1.position.x,
      this.control1.position.y,
      this.start.position.x,
      this.start.position.y
    );

    renderer.drawLine(
      this.control2.position.x,
      this.control2.position.y,
      this.end.position.x,
      this.end.position.y
    );

    // Draw the curve
    renderer.beginPath();
    renderer.moveTo(this.start.position.x, this.start.position.y);
    renderer.cubicTo(
      this.control1.position.x,
      this.control1.position.y,
      this.control2.position.x,
      this.control2.position.y,
      this.end.position.x,
      this.end.position.y
    );
    renderer.drawPath(/* style */);

    // Draw handles
    this.start.draw(renderer);
    this.end.draw(renderer);
    this.control1.draw(renderer);
    this.control2.draw(renderer);
  }
}
