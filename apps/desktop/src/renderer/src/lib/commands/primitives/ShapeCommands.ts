import { Vec2, type Rect2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import { Point } from "@shift/glyph-state";
import { BaseCommand, type CommandContext } from "../core/Command";

export class DrawRectangleCommand extends BaseCommand<ContourId> {
  readonly name = "Draw Rectangle";

  readonly #rect: Rect2D;
  #contourId: ContourId | null = null;
  #pointIds: PointId[] = [];

  constructor(rect: Rect2D) {
    super();
    this.#rect = rect;
  }

  execute(ctx: CommandContext): ContourId {
    this.#pointIds = [];
    this.#contourId = ctx.source.addContour();

    const origin = Vec2.create(this.#rect.x, this.#rect.y);
    const topLeft = origin;
    const topRight = Vec2.add(origin, Vec2.create(this.#rect.width, 0));
    const bottomRight = Vec2.add(origin, Vec2.create(this.#rect.width, this.#rect.height));
    const bottomLeft = Vec2.add(origin, Vec2.create(0, this.#rect.height));

    const topLeftPoint = Point.onCurve(topLeft);
    const topRightPoint = Point.onCurve(topRight);
    const bottomRightPoint = Point.onCurve(bottomRight);
    const bottomLeftPoint = Point.onCurve(bottomLeft);

    this.#pointIds.push(ctx.source.addPoint(this.#contourId, topLeftPoint));
    this.#pointIds.push(ctx.source.addPoint(this.#contourId, topRightPoint));
    this.#pointIds.push(ctx.source.addPoint(this.#contourId, bottomRightPoint));
    this.#pointIds.push(ctx.source.addPoint(this.#contourId, bottomLeftPoint));

    ctx.source.closeContour(this.#contourId);

    return this.#contourId;
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length > 0) {
      ctx.source.removePoints(this.#pointIds);
    }
  }
}
