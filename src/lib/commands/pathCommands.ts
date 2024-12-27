import { Path } from "../geometry/path";
import { Point } from "../geometry/point";
import { Command } from "./commands";

export class AddPoint implements Command {
  constructor(private point: Point, private path: Path) {}

  execute(): void {
    this.path.addPoint(this.point);
  }
}
