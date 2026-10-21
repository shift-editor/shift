import { EntityMap, mintNodeId, type NodeId, type ReadonlyEntityMap } from "@shift/types";
import { Tree } from "../utils/Tree";
import { computed, type Signal } from "../signals/index";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { NodeReference, ShiftEditorRecord, ShiftNodeRecord } from "../../types/records";
import type { CreateNode, NodeKind, NodeOfKind, ShiftNode, UpdateNode } from "../../types/node";

export interface SceneValue {
  /** Every node, parents before children, siblings by `index`. */
  readonly nodes: readonly ShiftNode[];
  readonly tree: Tree<NodeId, ShiftNode>;
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
  readonly #nodesById: Signal<ReadonlyEntityMap<NodeId, ShiftNode>>;
  readonly #nodesByKind: Signal<ReadonlyMap<NodeKind, readonly ShiftNode[]>>;
  readonly #onlyCellsByKind = new Map<NodeKind, Signal<ShiftNode | null>>();
  readonly #byReference: StoreIndex<NodeReference, ShiftNodeRecord>;

  /**
   * @param store - editor store holding node records.
   * @param references - what a node depends on; usually its definition's `references`.
   */
  constructor(
    store: ShiftStore<ShiftEditorRecord>,
    references: (node: ShiftNode) => readonly NodeReference[] = () => [],
  ) {
    this.#store = store;
    this.#byReference = store.index("node", references);
    this.#cell = computed(
      () => {
        const nodes = this.#store.recordsOfType("node");
        const tree = Tree.from<NodeId, ShiftNode>(nodes, {
          id: (node) => node.id,
          parentId: (node) => node.parentId,
          order: (a, b) => compareIndex(a.index, b.index),
        });
        return { nodes: tree.walk(), tree };
      },
      // Reads only node records, so selection, editing, and run writes to the shared store
      // never rebuild the scene.
      { name: "editor.scene" },
    );
    this.#nodesById = computed(
      () => {
        return new EntityMap(
          "node",
          this.#cell.value.nodes.map((node) => [node.id, node] as const),
        );
      },
      { name: "editor.scene.nodesById" },
    );
    this.#nodesByKind = computed(
      () => {
        const nodes = new Map<NodeKind, ShiftNode[]>();
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

  /**
   * Returns every node with each parent before its children.
   *
   * @remarks
   * Drawing in this order paints children over their parent; hit testing in
   * reverse tries children first. A node whose parent is missing is treated as
   * a root.
   */
  nodes(): readonly ShiftNode[] {
    return this.#cell.peek().nodes;
  }

  node(nodeId: NodeId | null): ShiftNode | null {
    if (!nodeId) return null;

    return this.#nodesById.peek().get(nodeId);
  }

  /**
   * Returns the nodes that depend on a record or glyph.
   *
   * @remarks
   * A node depends on whatever its definition's `references` names: a text
   * run node on its run record, a glyph node on its glyph. Reactive: inside a
   * computed or effect, the reader reruns only when the nodes filed under `id`
   * change.
   */
  nodesReferencing(id: NodeReference): readonly ShiftNode[] {
    return this.#byReference.get(id);
  }

  /** Returns a node's children, ordered by `index`. */
  children(nodeId: NodeId): readonly ShiftNode[] {
    return this.#cell.peek().tree.children(nodeId);
  }

  /** Yields a node's ancestors, nearest first. */
  ancestors(nodeId: NodeId): Iterable<ShiftNode> {
    return this.#cell.peek().tree.ancestors(nodeId);
  }

  /** Returns a node's parent, or null for root nodes. */
  parent(nodeId: NodeId): ShiftNode | null {
    return this.#cell.peek().tree.parent(nodeId);
  }

  /** Returns the node with `nodeId` when it is of `kind`, else null. */
  nodeOfKind<K extends NodeKind>(nodeId: NodeId | null, kind: K): NodeOfKind<K> | null {
    const node = this.node(nodeId);
    if (node?.kind !== kind) return null;

    return node as NodeOfKind<K>;
  }

  /** Returns every node of `kind`, parents before children. */
  nodesOfKind<K extends NodeKind>(kind: K): readonly NodeOfKind<K>[] {
    return (this.#nodesByKind.peek().get(kind) ?? []) as readonly NodeOfKind<K>[];
  }

  /**
   * Returns the scene's one node of `kind`.
   *
   * @remarks
   * Commands that act on "the glyph" need exactly one; with none or several
   * there is no single target, so this returns null.
   */
  only<K extends NodeKind>(kind: K): NodeOfKind<K> | null {
    const nodes = this.nodesOfKind(kind);
    return nodes.length === 1 ? (nodes[0] ?? null) : null;
  }

  /**
   * Reactive {@link only}: the scene's one node of `kind`, or null with none or
   * several.
   *
   * @remarks
   * Readers rerun when the nodes of `kind` change, not on every scene change.
   * One cell per kind, created on first use.
   */
  onlyCell<K extends NodeKind>(kind: K): Signal<NodeOfKind<K> | null> {
    let cell = this.#onlyCellsByKind.get(kind);
    if (!cell) {
      cell = computed(
        () => {
          const nodes = this.#nodesByKind.value.get(kind) ?? [];
          return nodes.length === 1 ? (nodes[0] ?? null) : null;
        },
        { name: `editor.scene.only.${kind}` },
      );
      this.#onlyCellsByKind.set(kind, cell);
    }

    return cell as Signal<NodeOfKind<K> | null>;
  }

  /** Returns the first node of `kind` in scene order, or null when there is none. */
  first<K extends NodeKind>(kind: K): NodeOfKind<K> | null {
    return this.nodesOfKind(kind)[0] ?? null;
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

function compareIndex(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function copyNode<T extends ShiftNode>(node: T): T {
  return {
    ...node,
    position: { ...node.position },
  };
}
