import type { PointId } from "@shift/types";
import type { Command, CommandContext } from "../core/Command";
import type { AlignmentType, DistributeType } from "@/types/transform";

/**
 * Aligns selected points along one edge or center of the selection's own
 * bounding box (not the glyph bounds). Supports left, right, top, bottom,
 * horizontal center, and vertical center.
 */
export class AlignPointsCommand implements Command<void> {
  readonly name: string;

  readonly #pointIds: PointId[];
  readonly #alignment: AlignmentType;

  constructor(pointIds: PointId[], alignment: AlignmentType) {
    this.#pointIds = [...pointIds];
    this.#alignment = alignment;
    this.name = `Align ${alignment}`;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    ctx.source.align(this.#pointIds, this.#alignment);
  }
}

/**
 * Evenly distributes selected points along the horizontal or vertical axis.
 * Requires at least 3 points; the outermost points remain fixed while inner
 * points are spaced equally between them.
 */
export class DistributePointsCommand implements Command<void> {
  readonly name: string;

  readonly #pointIds: PointId[];
  readonly #type: DistributeType;

  constructor(pointIds: PointId[], type: DistributeType) {
    this.#pointIds = [...pointIds];
    this.#type = type;
    this.name = `Distribute ${type}`;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length < 3) return;

    ctx.source.distribute(this.#pointIds, this.#type);
  }
}
