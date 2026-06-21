import { Vec2, type Rect2D } from "@shift/geo";
import type { ContourId } from "@shift/types";
import { Point } from "@shift/glyph-state";
import type { Command, CommandContext } from "../core/Command";

export class DrawRectangleCommand implements Command<ContourId> {
  readonly name = "Draw Rectangle";

  readonly #rect: Rect2D;

  constructor(rect: Rect2D) {
    this.#rect = rect;
  }

  execute(ctx: CommandContext): ContourId {
    const contourId = ctx.layer.addContour();

    const origin = Vec2.create(this.#rect.x, this.#rect.y);
    const topLeft = origin;
    const topRight = Vec2.add(origin, Vec2.create(this.#rect.width, 0));
    const bottomRight = Vec2.add(origin, Vec2.create(this.#rect.width, this.#rect.height));
    const bottomLeft = Vec2.add(origin, Vec2.create(0, this.#rect.height));

    ctx.layer.addPoint(contourId, Point.onCurve(topLeft));
    ctx.layer.addPoint(contourId, Point.onCurve(topRight));
    ctx.layer.addPoint(contourId, Point.onCurve(bottomRight));
    ctx.layer.addPoint(contourId, Point.onCurve(bottomLeft));

    ctx.layer.closeContour(contourId);

    return contourId;
  }
}
