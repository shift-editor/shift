import { Ident } from "../core/EntityId";
import { Path, PathPoint, PointType } from "../core/Path";
import { Point } from "../geometry/point";

export class PathManager {
  #currentPath: Path;
  #paths: Map<Ident, Path> = new Map();

  constructor() {
    this.#currentPath = new Path();
    this.#paths.set(this.#currentPath.id, this.#currentPath);
  }

  addPath(): void {
    const p = new Path();
    this.#paths.set(p.id, p);
  }

  addPoint(point: Point) {
    this.#currentPath.points.push(
      new PathPoint(point.x, point.y, PointType.OnCurve, this.#currentPath.id)
    );
  }

  get paths(): Path[] {
    return Array.from(this.#paths.values());
  }

  get currentPath(): Path {
    return this.#currentPath;
  }
}
