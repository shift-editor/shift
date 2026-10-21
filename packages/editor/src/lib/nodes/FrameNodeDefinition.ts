import { Bounds, Mat, type Point2D } from "@shift/geo";
import type { SelectableId } from "@shift/types";
import { NodeDefinition } from "./NodeDefinition";
import { FrameTransform } from "../frames/FrameTransform";
import { localBounds } from "../editor/spaces";
import { track } from "../signals";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import type { FrameNode, ShiftNode } from "../../types/node";
import type { LaidOutNode } from "../../types/frame";
import type { PointerTarget } from "../../types/target";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { TransformTarget } from "../../types/transformTarget";

/**
 * Behavior of an auto layout frame.
 *
 * @remarks
 * A frame draws in Y-down scene units from its top-left corner. Its size and
 * its children's places come from the page layout (`Frames.layoutCell`), so
 * the queries here track that layout. A frame is selectable: it is hit
 * anywhere in its box where no child is hit, and the transform box moves and
 * resizes it (see {@link FrameTransform}).
 */
export class FrameNodeDefinition extends NodeDefinition<FrameNode> {
  readonly kind: FrameNode["kind"] = "frame";
  override readonly selectable = true;

  unitsTransform(_node: FrameNode): Mat {
    return Mat.Identity();
  }

  /** The frame's laid-out box from its origin; null until the page is laid out. */
  bounds(node: FrameNode): LocalBounds | null {
    const box = this.#laidOut(node)?.box;
    if (!box) return null;

    return localBounds(Bounds.fromXYWH(0, 0, box.width, box.height));
  }

  /** Places text runs and frames where the page layout put them. */
  override childPosition(node: FrameNode, child: ShiftNode): Point2D | null {
    if (child.parentId !== node.id) return null;

    return this.#laidOut(child)?.origin ?? null;
  }

  /** Hits the frame's box, grown by the hit radius so its edges are easy to grab. */
  hit(node: FrameNode, point: LocalPoint): PointerTarget | null {
    const bounds = this.bounds(node);
    if (!bounds || !Bounds.containsPoint(Bounds.expand(bounds, this.editor.hitRadius), point)) {
      return null;
    }

    return { kind: "node", node, point };
  }

  /** The frame alone moves and resizes; anything else selected with it does not. */
  override transformTarget(node: FrameNode, ids: readonly SelectableId[]): TransformTarget | null {
    const bounds = this.bounds(node);
    if (!bounds || ids.length !== 1 || ids[0] !== node.id) return null;

    return new FrameTransform(this.editor, node, Bounds.toRect(bounds));
  }

  override draw(node: FrameNode, ctx: RenderContext, pass: RenderPass): void {
    const bounds = this.bounds(node);
    if (!bounds) return;

    const { frame } = ctx.canvas.theme;
    const width = Bounds.width(bounds);
    const height = Bounds.height(bounds);
    switch (pass) {
      case "background":
        ctx.canvas.fillRect(0, 0, width, height, frame.fill);
        ctx.canvas.strokeRect(0, 0, width, height, frame.stroke, frame.widthPx);
        return;
      case "controls":
        if (!this.editor.selection.has(node.id)) return;
        ctx.canvas.strokeRect(0, 0, width, height, frame.selectedStroke, frame.selectedWidthPx);
        return;
      case "content":
      case "overlay":
        return;
    }
  }

  #laidOut(node: ShiftNode): LaidOutNode | null {
    const layoutCell = this.editor.frames.layoutCell;
    track(layoutCell);
    return layoutCell.peek().get(node.id) ?? null;
  }
}
