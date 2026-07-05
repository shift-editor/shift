import type { Rect2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { ShiftObjectOf } from "@/types";
import type { ShiftNode } from "@/types/node";

/**
 * Resolved scene node in the current editor scene.
 *
 * @remarks
 * Node-specific bounds will eventually delegate to the node kind's object
 * definition. Until those definitions exist, bare node bounds are absent.
 */
export class NodeObject implements ShiftObjectOf<"node"> {
  readonly kind = "node";
  readonly id: NodeId;
  readonly node: ShiftNode;

  /**
   * Creates a scene node object.
   *
   * @param node - Placed scene node to expose as an object.
   */
  constructor(node: ShiftNode) {
    this.id = node.id;
    this.node = node;
  }

  /**
   * Returns scene-space bounds for this node.
   *
   * @returns null until node-kind bounds definitions are available.
   */
  bounds(): Rect2D | null {
    return null;
  }
}
