import type { NodeId } from "@shift/types";
import { signal, track, type WritableSignal } from "../signals/index";
import type { GlyphOutlinesByNode, GlyphOutlineTarget } from "../../types/glyphOutline";

/** Owns session-only variation outlines associated with glyph scene nodes. */
export class GlyphOutlines {
  readonly #targetsCell: WritableSignal<GlyphOutlinesByNode> = signal(new Map(), {
    name: "glyphNode.outlines",
  });

  /**
   * Replaces every visible outline for one glyph node.
   *
   * @param nodeId - Scene occurrence whose additional locations should be outlined.
   * @param targets - Complete ordered outline collection; an empty collection clears the node.
   */
  set(nodeId: NodeId, targets: readonly GlyphOutlineTarget[]): void {
    if (targets.length === 0) {
      this.clear(nodeId);
      return;
    }

    const targetsByNode = new Map(this.#targetsCell.peek());
    targetsByNode.set(nodeId, [...targets]);
    this.#targetsCell.set(targetsByNode);
  }

  /**
   * Removes every visible outline associated with one glyph node.
   *
   * @param nodeId - Scene occurrence whose outline collection should be removed.
   */
  clear(nodeId: NodeId): void {
    const targetsByNode = new Map(this.#targetsCell.peek());
    if (!targetsByNode.delete(nodeId)) return;

    this.#targetsCell.set(targetsByNode);
  }

  /**
   * Returns the current ordered outlines for a glyph node and tracks render invalidation.
   *
   * @param nodeId - Scene occurrence being rendered.
   * @returns The retained immutable collection, or an empty collection when none is registered.
   */
  forNode(nodeId: NodeId): readonly GlyphOutlineTarget[] {
    track(this.#targetsCell);
    return this.#targetsCell.peek().get(nodeId) ?? [];
  }
}
