import { EntityMap, mintNodeId, type NodeId, type ReadonlyEntityMap } from "@shift/types";
import { Tree } from "../utils/Tree";
import { computed, signal, type Signal, type WritableSignal } from "../signals/index";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { NodeReference, ShiftEditorRecord, ShiftNodeRecord } from "../../types/records";
import {
  PageNode,
  type CreateNode,
  type NodeKind,
  type NodeOfKind,
  type ShiftNode,
  type UpdateNode,
} from "../../types/node";
import { IndexKey } from "../../types/indexKey";

/** Name given to the page a scene gets when it has none. */
export const DEFAULT_PAGE_NAME = "Page 1";

export interface SceneValue {
  /** The nodes on the active page, parents before children, siblings by `index`; the page itself is not included. */
  readonly nodes: readonly ShiftNode[];
  /** Every node on every page. */
  readonly tree: Tree<NodeId, ShiftNode>;
}

interface DocumentValue {
  /** Every node, parents before children, siblings by `index`. */
  readonly nodes: readonly ShiftNode[];
  readonly tree: Tree<NodeId, ShiftNode>;
}

/**
 * Exposes the editor's placed node graph.
 *
 * Scene is the semantic API over node records in the flat editor store. It owns
 * node-level queries and replacement rules; the store only owns record storage.
 *
 * @remarks
 * The roots of the scene are pages, and every other node descends from one.
 * The canvas shows one page at a time ({@link shownPageIdCell}), so the
 * collection queries (`cell`, `nodes`, `nodesOfKind`, `only`, `first`) answer
 * for the shown page only.
 * Lookups by id (`node`, `children`, `parent`, `ancestors`,
 * `nodesReferencing`) and {@link allNodes} see every page.
 */
export class Scene {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #documentCell: Signal<DocumentValue>;
  readonly #pagesCell: Signal<readonly PageNode[]>;
  readonly #requestedPageIdCell: WritableSignal<NodeId | null>;
  readonly #shownPageIdCell: Signal<NodeId | null>;
  readonly #pageIdByNodeCell: Signal<ReadonlyMap<NodeId, NodeId>>;
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
    this.#documentCell = computed(
      () => {
        const nodes = this.#store.recordsOfType("node");
        const tree = Tree.from<NodeId, ShiftNode>(nodes, {
          id: (node) => node.id,
          parentId: (node) => node.parentId,
          order: (a, b) => IndexKey.compare(a.index, b.index),
        });
        return { nodes: tree.walk(), tree };
      },
      // Reads only node records, so selection, editing, and run writes to the shared store
      // never rebuild the scene.
      { name: "editor.scene.document" },
    );
    this.#pagesCell = computed(
      () => this.#documentCell.value.tree.roots().filter((node) => node.kind === "page"),
      // Most node writes touch no page; keep the list's identity so a pages list does not rerender.
      { name: "editor.scene.pages", equals: PageNode.sameList },
    );
    this.#requestedPageIdCell = signal<NodeId | null>(null, {
      name: "editor.scene.requestedPage",
    });
    this.#shownPageIdCell = computed(
      () => {
        const pages = this.#pagesCell.value;
        const requested = this.#requestedPageIdCell.value;
        const page = pages.find((candidate) => candidate.id === requested) ?? pages[0];
        return page?.id ?? null;
      },
      { name: "editor.scene.shownPage" },
    );
    this.#pageIdByNodeCell = computed(
      () => {
        const { tree } = this.#documentCell.value;
        const pageIds = new Map<NodeId, NodeId>();
        for (const page of this.#pagesCell.value) {
          pageIds.set(page.id, page.id);
          for (const node of tree.descendants(page.id)) pageIds.set(node.id, page.id);
        }
        return pageIds;
      },
      { name: "editor.scene.pageIdByNode" },
    );
    this.#cell = computed(
      () => {
        const { tree } = this.#documentCell.value;
        const pageId = this.#shownPageIdCell.value;
        const nodes = pageId ? [...tree.descendants(pageId)] : [];
        return { nodes, tree };
      },
      { name: "editor.scene" },
    );
    this.#nodesById = computed(
      () => {
        // Lookups by id see every page, not only the one shown.
        return new EntityMap(
          "node",
          this.#documentCell.value.nodes.map((node) => [node.id, node] as const),
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

  /** The active page's nodes; reading it inside a reactive boundary reruns on page switches and node writes. */
  get cell(): Signal<SceneValue> {
    return this.#cell;
  }

  get value(): SceneValue {
    return this.#cell.peek();
  }

  /**
   * Returns the active page's nodes with each parent before its children.
   *
   * @remarks
   * Drawing in this order paints children over their parent; hit testing in
   * reverse tries children first. The page itself is not included.
   */
  nodes(): readonly ShiftNode[] {
    return this.#cell.peek().nodes;
  }

  /**
   * Returns every node on every page, pages included, parents before children.
   *
   * @remarks
   * For code that owns the whole document, such as saving the scene. A node
   * whose parent is missing is treated as a root.
   */
  allNodes(): readonly ShiftNode[] {
    return this.#documentCell.peek().nodes;
  }

  /** Pages in list order; the list keeps its identity until a page record changes. */
  get pagesCell(): Signal<readonly PageNode[]> {
    return this.#pagesCell;
  }

  /** Returns the pages in list order. */
  pages(): readonly PageNode[] {
    return this.#pagesCell.peek();
  }

  /**
   * The page the canvas shows; null only while the scene has no page.
   *
   * @remarks
   * The one owner of the shown page: the page-scoped queries read it.
   * Session state, never stored. Falls back to the first page when the page
   * last shown is deleted (including by undo). `Pages.activate` switches it
   * and keeps each page's camera.
   */
  get shownPageIdCell(): Signal<NodeId | null> {
    return this.#shownPageIdCell;
  }

  /** Returns the page the canvas shows, or null while the scene has no page. */
  shownPage(): PageNode | null {
    return this.nodeOfKind(this.#shownPageIdCell.peek(), "page");
  }

  /**
   * Shows a page on the canvas.
   *
   * @remarks
   * Navigation only: writes no record, so it is never an undo step. Callers
   * that also keep per-page view state use `Pages.activate`.
   */
  showPage(pageId: NodeId): void {
    if (!this.nodeOfKind(pageId, "page")) return;

    this.#requestedPageIdCell.set(pageId);
  }

  /**
   * Returns the shown page, creating {@link DEFAULT_PAGE_NAME} first when the scene has none.
   *
   * @remarks
   * Writes a record when it creates the page, so inside a capture the
   * creation is part of that undo step.
   */
  ensurePage(): PageNode {
    return (
      this.shownPage() ??
      this.createNode<PageNode>({
        kind: "page",
        name: DEFAULT_PAGE_NAME,
        position: { x: 0, y: 0 },
      })
    );
  }

  /** Returns the page a node is on (the page itself for a page), or null for a node on no page. */
  pageOf(nodeId: NodeId): PageNode | null {
    return this.nodeOfKind(this.#pageIdByNodeCell.peek().get(nodeId) ?? null, "page");
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
    return this.#documentCell.peek().tree.children(nodeId);
  }

  /** Returns a node's descendants on any page, parents before children. */
  descendants(nodeId: NodeId): readonly ShiftNode[] {
    return [...this.#documentCell.peek().tree.descendants(nodeId)];
  }

  /** Yields a node's ancestors, nearest first. */
  ancestors(nodeId: NodeId): Iterable<ShiftNode> {
    return this.#documentCell.peek().tree.ancestors(nodeId);
  }

  /** Returns a node's parent, or null for root nodes. */
  parent(nodeId: NodeId): ShiftNode | null {
    return this.#documentCell.peek().tree.parent(nodeId);
  }

  /** Returns the node with `nodeId` when it is of `kind`, else null. */
  nodeOfKind<K extends NodeKind>(nodeId: NodeId | null, kind: K): NodeOfKind<K> | null {
    const node = this.node(nodeId);
    if (node?.kind !== kind) return null;

    return node as NodeOfKind<K>;
  }

  /** Returns every node of `kind` on the active page, parents before children. */
  nodesOfKind<K extends NodeKind>(kind: K): readonly NodeOfKind<K>[] {
    return (this.#nodesByKind.peek().get(kind) ?? []) as readonly NodeOfKind<K>[];
  }

  /**
   * Returns the active page's one node of `kind`.
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
   * Reactive {@link only}: the active page's one node of `kind`, or null with
   * none or several.
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

  /** Returns the first node of `kind` on the active page in scene order, or null when there is none. */
  first<K extends NodeKind>(kind: K): NodeOfKind<K> | null {
    return this.nodesOfKind(kind)[0] ?? null;
  }

  /**
   * Creates a placed scene node and returns the completed record.
   *
   * @remarks
   * A node other than a page created without a parent goes on the active page
   * (see {@link ensurePage}).
   *
   * @param node - Kind-specific node fields plus placement; identity, parent,
   * and ordering fields are optional.
   * @returns the stored node record with scene-owned defaults filled in.
   */
  createNode<N extends ShiftNode>(node: CreateNode<N>): N {
    const parentId = node.parentId ?? (node.kind === "page" ? null : this.ensurePage().id);
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

  /** Replaces every node on every page. */
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

  /**
   * Deletes a node and everything under it, children before their parents.
   *
   * @returns the deleted nodes, the node itself last.
   */
  deleteSubtree(nodeId: NodeId): readonly ShiftNode[] {
    const node = this.node(nodeId);
    if (!node) return [];

    const deleted = [...this.descendants(nodeId)].reverse();
    deleted.push(node);
    for (const each of deleted) this.#store.delete(each.id);
    return deleted;
  }

  clear(): void {
    this.#deleteNodes();
  }

  #deleteNodes(): void {
    for (const node of this.allNodes()) {
      this.#store.delete(node.id);
    }
  }

  #nextIndex(parentId: NodeId | null): string {
    const { tree } = this.#documentCell.peek();
    const siblings = parentId ? tree.children(parentId) : tree.roots();

    return IndexKey.between(siblings.at(-1)?.index ?? null, null);
  }
}

function copyNode<T extends ShiftNode>(node: T): T {
  return {
    ...node,
    position: { ...node.position },
  };
}
