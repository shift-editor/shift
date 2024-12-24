import { Path } from "../geometry/path";
import { Point } from "../geometry/point";
import { SegmentType } from "../geometry/segment";

interface Command {
  execute(): void;
}

export class AddPoint implements Command {
  constructor(private point: Point, private path: Path) {}

  execute(): void {
    this.path.addPoint(this.point, SegmentType.Line);
  }
}

export class CommandManager {
  commands: Command[] = [];

  execute(cmd: Command): void {
    cmd.execute();
    this.commands.push(cmd);
  }
}
