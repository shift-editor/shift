import type { Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import { signal, type Signal, type WritableSignal } from "@/lib/signals";
import type { ShiftNode } from "@/types/node";

export interface SceneInput {
  readonly nodes: readonly ShiftNode[];
}

export interface SceneValue {
  readonly nodes: readonly ShiftNode[];
}

/**
 * Owns the placed nodes visible in the editor scene.
 *
 * @remarks
 * Scene stores canvas identity and position. It does not resolve glyph models,
 * glyph instances, glyph layers, or decide what authored data a command mutates.
 */
export class Scene {
  readonly #cell: WritableSignal<SceneValue>;

  constructor() {
    this.#cell = signal<SceneValue>(emptyScene(), { name: "editor.scene" });
  }

  /** Returns the reactive scene snapshot. */
  get cell(): Signal<SceneValue> {
    return this.#cell;
  }

  /** Returns the current scene snapshot. */
  get value(): SceneValue {
    return this.#cell.peek();
  }

  /** Returns all placed nodes as a read-only snapshot. */
  nodes(): readonly ShiftNode[] {
    return this.#cell.peek().nodes;
  }

  /**
   * Resolves a placed node by id.
   *
   * @param nodeId - Placement identity to resolve.
   * @returns The placed node, or `null` when the node is not in the scene.
   */
  node(nodeId: NodeId | null): ShiftNode | null {
    if (!nodeId) return null;

    return this.#cell.peek().nodes.find((node) => node.id === nodeId) ?? null;
  }

  /**
   * Replaces the complete scene.
   *
   * @param scene - Complete scene description. Nodes are copied by value.
   */
  set(scene: SceneInput): void {
    this.#cell.set({
      nodes: scene.nodes.map(copyNode),
    });
  }

  /** Clears all scene nodes. */
  clear(): void {
    this.#cell.set(emptyScene());
  }

  /**
   * Adds one node to the scene.
   *
   * @param node - Complete node identity and scene-space position to add.
   */
  addNode(node: ShiftNode): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      nodes: [...scene.nodes, copyNode(node)],
    });
  }

  /**
   * Replaces a node's scene-space position.
   *
   * @param nodeId - Placement identity whose position is updated.
   * @param position - Destination position in scene coordinates.
   */
  moveNodeTo(nodeId: NodeId, position: Point2D): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      nodes: scene.nodes.map((node) =>
        node.id === nodeId ? copyNode({ ...node, position: { ...position } }) : node,
      ),
    });
  }

  /**
   * Offsets a node's scene-space position.
   *
   * @param nodeId - Placement identity whose position is updated.
   * @param delta - Relative movement in scene coordinates.
   */
  moveNodeBy(nodeId: NodeId, delta: Point2D): void {
    const node = this.node(nodeId);
    if (!node) return;

    this.moveNodeTo(nodeId, {
      x: node.position.x + delta.x,
      y: node.position.y + delta.y,
    });
  }
}

function copyNode<T extends ShiftNode>(node: T): T {
  return {
    ...node,
    position: { ...node.position },
  };
}

function emptyScene(): SceneValue {
  return { nodes: [] };
}
