import type { LocalBounds } from "../../types/coordinates";
import type { NodeId } from "@shift/types";
import type { NodeDefinition } from "../nodes/NodeDefinition";
import type { ShiftObjectOf } from "../../types/object";
import type { ShiftNode } from "../../types/node";

/**
 * Resolved scene node in the current editor scene.
 *
 * @remarks
 * Node-specific bounds delegate to the node kind's definition when that
 * behavior is registered for the current editor session.
 */
export class NodeObject implements ShiftObjectOf<"node"> {
  readonly kind = "node";
  readonly id: NodeId;
  readonly node: ShiftNode;
  readonly #definition: NodeDefinition | null;

  /**
   * Creates a scene node object.
   *
   * @param node - Placed scene node to expose as an object.
   * @param definition - Registered behavior for this node kind.
   */
  constructor(node: ShiftNode, definition: NodeDefinition | null) {
    this.id = node.id;
    this.node = node;
    this.#definition = definition;
  }

  /**
   * Returns this node's bounds in its own units.
   *
   * @returns null when this node kind has no registered bounds behavior.
   */
  bounds(): LocalBounds | null {
    return this.#definition?.bounds(this.node) ?? null;
  }
}
