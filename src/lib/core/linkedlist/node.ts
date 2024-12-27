import { Point } from "../../geometry/point";

export class PointNode {
  constructor(
    private point: Point,
    private id: EntityId,
    private parentId: EntityId,
    private prev: EntityId | null,
    private next: EntityId | null
  ) {}
}
