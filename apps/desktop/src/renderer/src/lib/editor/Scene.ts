import { mintNodeId, type NodeId } from "@shift/types";
import { computed, type Signal } from "@/lib/signals";
import type { ShiftStore } from "@/lib/store/ShiftStore";
import type { ShiftEditorRecord, ShiftNodeRecord } from "@/types";
import type { CreateNode, ShiftNode, UpdateNode } from "@/types/node";

export interface SceneValue {
  readonly nodes: readonly ShiftNode[];
}

/**
 * Exposes the editor's placed node graph.
 *
 * Scene is the semantic API over node records in the flat editor store. It owns
 * node-level queries and replacement rules; the store only owns record storage.
 */
export class Scene {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #cell: Signal<SceneValue>;
  readonly #nodesById: Signal<ReadonlyMap<NodeId, ShiftNode>>;
  readonly #nodesByKind: Signal<ReadonlyMap<ShiftNode["kind"], readonly ShiftNode[]>>;

  constructor(store: ShiftStore<ShiftEditorRecord>) {
    this.#store = store;
    this.#cell = computed(
      () => {
        const nodes: ShiftNodeRecord[] = [];
        for (const record of this.#store.cell.value.values()) {
          if (record.type === "node") nodes.push(record);
        }

        return { nodes };
      },
      { name: "editor.scene" },
    );
    this.#nodesById = computed(
      () => {
        const nodes = new Map<NodeId, ShiftNode>();
        for (const node of this.#cell.value.nodes) {
          nodes.set(node.id, node);
        }
        return nodes;
      },
      { name: "editor.scene.nodesById" },
    );
    this.#nodesByKind = computed(
      () => {
        const nodes = new Map<ShiftNode["kind"], ShiftNode[]>();
        for (const node of this.#cell.value.nodes) {
          const list = nodes.get(node.kind);
          if (list) {
            list.push(node);
          } else {
            nodes.set(node.kind, [node]);
          }
        }
        return nodes;
      },
      { name: "editor.scene.nodesByKind" },
    );
  }

  get cell(): Signal<SceneValue> {
    return this.#cell;
  }

  get value(): SceneValue {
    return this.#cell.peek();
  }

  nodes(): readonly ShiftNode[] {
    return this.#cell.peek().nodes;
  }

  node(nodeId: NodeId | null): ShiftNode | null {
    if (!nodeId) return null;

    return this.#nodesById.peek().get(nodeId) ?? null;
  }

  nodeOfKind<K extends ShiftNode["kind"]>(
    nodeId: NodeId | null,
    kind: K,
  ): Extract<ShiftNode, { kind: K }> | null {
    const node = this.node(nodeId);
    if (node?.kind !== kind) return null;

    return node as Extract<ShiftNode, { kind: K }>;
  }

  nodesOfKind<K extends ShiftNode["kind"]>(kind: K): readonly Extract<ShiftNode, { kind: K }>[] {
    return (this.#nodesByKind.peek().get(kind) ?? []) as readonly Extract<ShiftNode, { kind: K }>[];
  }

  /**
   * Creates a placed scene node and returns the completed record.
   *
   * @param node - Kind-specific node fields plus placement; identity, parent,
   * and ordering fields are optional.
   * @returns the stored node record with scene-owned defaults filled in.
   */
  createNode<N extends ShiftNode>(node: CreateNode<N>): N {
    const parentId = node.parentId ?? null;
    const next = {
      ...node,
      id: node.id ?? mintNodeId(),
      type: "node",
      parentId,
      index: node.index ?? this.#nextIndex(parentId),
      position: { ...node.position },
    } as unknown as N;

    this.#store.put(copyNode(next) as ShiftNodeRecord);

    return next;
  }

  setNodes(nodes: readonly ShiftNode[]): void {
    this.#deleteNodes();

    for (const node of nodes) {
      this.#store.put(copyNode(node) as ShiftNodeRecord);
    }
  }

  /**
   * Updates mutable fields on an existing scene node.
   *
   * @param update - mutable node fields to merge into the current record.
   */
  updateNode(update: UpdateNode): void {
    const node = this.node(update.id);
    if (!node) return;

    this.#store.put(copyNode({ ...node, ...update } as ShiftNode) as ShiftNodeRecord);
  }

  deleteNode(nodeId: NodeId): void {
    this.#store.delete(nodeId);
  }

  clear(): void {
    this.#deleteNodes();
  }

  #deleteNodes(): void {
    for (const node of this.nodes()) {
      this.#store.delete(node.id);
    }
  }

  #nextIndex(parentId: NodeId | null): string {
    const siblingCount = this.nodes().filter((node) => node.parentId === parentId).length;

    return `a${siblingCount}`;
  }
}

function copyNode<T extends ShiftNode>(node: T): T {
  return {
    ...node,
    position: { ...node.position },
  };
}
