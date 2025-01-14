import { Path } from "../core/Path";
import { Point } from "../geometry/point";
import { Command } from "./commands";

export class AddPoint implements Command {
  constructor(private point: Point, private path: Path) {}

  execute(): void {}
}
