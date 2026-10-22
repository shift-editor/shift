import { Bounds, Mat, type Point2D } from "@shift/geo";
import type { SelectableId } from "@shift/types";
import { NodeDefinition } from "./NodeDefinition";
import { FrameTransform } from "../frames/FrameTransform";
import { localBounds } from "../editor/spaces";
import type { LocalBounds, LocalPoint, SpaceTransform } from "../../types/coordinates";
import type { FrameNode, ShiftNode } from "../../types/node";
import type { LaidOutNode } from "../../types/frame";
import type { PointerTarget } from "../../types/target";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { RectPaint } from "../editor/rendering/Canvas";
import type { TransformTarget } from "../../types/transformTarget";

/**
 * Behavior of an auto layout frame.
 *
 * @remarks
 * A frame draws in Y-down scene units from its top-left corner. Its size and
 * its children's places come from the page layout (`Frames.laidOut`), so
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

  /** A frame paints its box behind its children, and its selection outline above them. */
  override drawsIn(node: FrameNode, pass: RenderPass): boolean {
    switch (pass) {
      case "background":
        return true;
      case "controls":
        return this.editor.selection.has(node.id);
      case "content":
      case "overlay":
        return false;
    }
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

  /** Paints the frame's box as {@link draw} does, straight in scene units, unless it is rotated or skewed. */
  override paintBackground(
    node: FrameNode,
    transform: SpaceTransform<"local", "scene">,
    ctx: RenderContext,
    paint: RectPaint,
  ): boolean {
    if (transform.b !== 0 || transform.c !== 0) return false;

    const bounds = this.bounds(node);
    if (!bounds) return true;

    const { frame } = ctx.canvas.theme;
    const { a, d, e, f } = transform;
    const width = a * Bounds.width(bounds);
    const height = d * Bounds.height(bounds);
    // A flipped axis gives a negative size; start from the box's lesser corner instead.
    const x = e + Math.min(width, 0);
    const y = f + Math.min(height, 0);
    paint.fill(frame.fill, x, y, Math.abs(width), Math.abs(height));
    paint.stroke(frame.stroke, frame.widthPx, x, y, Math.abs(width), Math.abs(height));
    return true;
  }

  #laidOut(node: ShiftNode): LaidOutNode | null {
    return this.editor.frames.laidOut(node.id);
  }
}
