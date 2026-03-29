import type { Point2D } from "@shift/types";
import type { NodeRef } from "@/types/positionUpdate";
import type { CommandContext } from "../core";

export interface NodePatchEntry {
  node: NodeRef;
  before: Point2D;
  after: Point2D;
}

/**
 * Applies a compact before/after patch for touched nodes (points/anchors).
 * Useful for drag sessions that should commit as a single undo step.
 */
export class NodePositionPatchCommand {
  readonly name: string;
  readonly #entries: readonly NodePatchEntry[];

  constructor(label: string, entries: readonly NodePatchEntry[]) {
    this.name = label;
    this.#entries = entries;
  }

  execute(ctx: CommandContext): void {
    if (this.#entries.length === 0) return;
    ctx.fontEngine.editing.setNodePositions(
      this.#entries.map((entry) => ({
        node: entry.node,
        x: entry.after.x,
        y: entry.after.y,
      })),
    );
  }

  undo(ctx: CommandContext): void {
    if (this.#entries.length === 0) return;
    ctx.fontEngine.editing.setNodePositions(
      this.#entries.map((entry) => ({
        node: entry.node,
        x: entry.before.x,
        y: entry.before.y,
      })),
    );
  }

  redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}
