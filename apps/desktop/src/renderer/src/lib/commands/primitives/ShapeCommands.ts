import type { Rect2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import type { PointEdit } from "@/lib/model/Glyph";
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

    this.#pointIds.push(
      ctx.source.addPoint(this.#contourId, pointEdit(this.#rect.x, this.#rect.y)),
    );
    this.#pointIds.push(
      ctx.source.addPoint(
        this.#contourId,
        pointEdit(this.#rect.x + this.#rect.width, this.#rect.y),
      ),
    );
    this.#pointIds.push(
      ctx.source.addPoint(
        this.#contourId,
        pointEdit(this.#rect.x + this.#rect.width, this.#rect.y + this.#rect.height),
      ),
    );
    this.#pointIds.push(
      ctx.source.addPoint(
        this.#contourId,
        pointEdit(this.#rect.x, this.#rect.y + this.#rect.height),
      ),
    );
    ctx.source.closeContour(this.#contourId);

    return this.#contourId;
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length > 0) {
      ctx.source.removePoints(this.#pointIds);
    }
  }
}

function pointEdit(x: number, y: number): PointEdit {
  return {
    x,
    y,
    pointType: "onCurve",
    smooth: false,
  };
}
