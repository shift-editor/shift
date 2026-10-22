import { mintNodeId, type NodeId } from "@shift/types";
import { Tree } from "../utils/Tree";
import {
  computed,
  signal,
  track,
  untracked,
  type Signal,
  type WritableSignal,
} from "../signals/index";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { NodeReference, ShiftEditorRecord, ShiftNodeRecord } from "../../types/records";
import type {
  CreateNode,
  NodeKind,
  NodeOfKind,
  PageNode,
  ShiftNode,
  UpdateNode,
} from "../../types/node";

/** Name given to the page a scene gets when it has none. */
export const DEFAULT_PAGE_NAME = "Page 1";

export interface SceneValue {
  /** The nodes on the active page, parents before children, siblings by `index`; the page itself is not included. */
  readonly nodes: readonly ShiftNode[];
}

/**
 * Every node's id, parent, and sibling order, on every page.
 *
 * @remarks
 * Holds ids only: a node's other fields are read from its record, so moving
 * or restyling a node never changes the structure.
 */
export type SceneStructure = Tree<NodeId, NodeId>;

/**
 * Exposes the editor's placed node graph.
 *
 * Scene is the semantic API over node records in the flat editor store. It owns
 * node-level queries and replacement rules; the store only owns record storage.
 *
 * @remarks
 * The roots of the scene are pages, and every other node descends from one.
 * The canvas shows one page at a time, so the collection queries (`cell`,
 * `nodes`, `nodesOfKind`, `only`, `first`) answer for the active page only.
 * Lookups by id (`node`, `children`, `parent`, `ancestors`,
 * `nodesReferencing`) and {@link allNodes} see every page.
 */
export class Scene {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #structureVersion: WritableSignal<number>;
  readonly #structureCell: Signal<SceneStructure>;
  readonly #pagesCell: Signal<readonly PageNode[]>;
  readonly #requestedPageId: WritableSignal<NodeId | null>;
  readonly #activePageIdCell: Signal<NodeId | null>;
  readonly #cell: Signal<SceneValue>;
  readonly #idsByKind: Signal<ReadonlyMap<NodeKind, readonly NodeId[]>>;
  readonly #byReference: StoreIndex<NodeReference, ShiftNodeRecord>;
  readonly #unsubscribe: () => void;

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
    this.#structureVersion = signal(0, { name: "editor.scene.structureVersion" });
    // Moves and edits leave the structure alone; only adding, removing, reparenting, or
    // reordering a node rebuilds it.
    this.#unsubscribe = store.onChange((change) => {
      if (changesStructure(change.before, change.after)) {
        this.#structureVersion.set(this.#structureVersion.peek() + 1);
      }
    });
    this.#structureCell = computed(
      () => {
        this.#structureVersion.value;
        const nodes = untracked(() => this.#store.recordsOfType("node"));
        const byId = new Map<NodeId, ShiftNodeRecord>(nodes.map((node) => [node.id, node]));
        return Tree.from<NodeId, NodeId>(
          nodes.map((node) => node.id),
          {
            id: (id) => id,
            parentId: (id) => byId.get(id)?.parentId ?? null,
            order: (a, b) => compareIndex(byId.get(a)!.index, byId.get(b)!.index),
          },
        );
      },
      { name: "editor.scene.structure" },
    );
    this.#pagesCell = computed(
      () =>
        this.#structureCell.value
          .roots()
          .map((id) => this.record(id))
          .filter((node): node is PageNode => node?.kind === "page"),
      // Most node writes touch no page; keep the list's identity so a pages list does not rerender.
      { name: "editor.scene.pages", equals: sameNodes },
    );
    this.#requestedPageId = signal<NodeId | null>(null, { name: "editor.scene.requestedPage" });
    this.#activePageIdCell = computed(
      () => {
        const pages = this.#pagesCell.value;
        const requested = this.#requestedPageId.value;
        const page = pages.find((candidate) => candidate.id === requested) ?? pages[0];
        return page?.id ?? null;
      },
      { name: "editor.scene.activePage" },
    );
    this.#cell = computed(
      () => {
        const tree = this.#structureCell.value;
        const pageId = this.#activePageIdCell.value;
        // Reruns on every node write, so readers of `cell` see moves and edits.
        this.#store.recordsOfType("node");
        const nodes = pageId ? this.#nodesFor([...tree.descendants(pageId)]) : [];
        return { nodes };
      },
      { name: "editor.scene" },
    );
    this.#idsByKind = computed(
      () => {
        const tree = this.#structureCell.value;
        const pageId = this.#activePageIdCell.value;
        const ids = new Map<NodeKind, NodeId[]>();
        if (!pageId) return ids;

        for (const id of tree.descendants(pageId)) {
          const kind = untracked(() => this.node(id))?.kind;
          if (!kind) continue;
          const list = ids.get(kind);
          if (list) list.push(id);
          else ids.set(kind, [id]);
        }
        return ids;
      },
      { name: "editor.scene.idsByKind" },
    );
  }

  /**
   * Every node's id, parent, and sibling order.
   *
   * @remarks
   * Reactive: readers rerun only when a node is added, removed, reparented,
   * or reordered, never when one moves or changes otherwise. Read node fields
   * with {@link record} to follow one node's edits.
   */
  get structureCell(): Signal<SceneStructure> {
    return this.#structureCell;
  }

  /**
   * Returns one node, subscribing only to that node's record.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns when this node is
   * written or deleted, and not when any other node changes.
   */
  record(nodeId: NodeId): ShiftNode | null {
    const record = this.#store.record(nodeId);
    return record?.type === "node" ? (record as ShiftNode) : null;
  }

  /** Stops following the store. */
  dispose(): void {
    this.#unsubscribe();
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
    return this.#nodesFor(this.#structureCell.peek().walk());
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
   * Session state, never stored. Falls back to the first page when the page
   * last shown is deleted (including by undo).
   */
  get activePageIdCell(): Signal<NodeId | null> {
    return this.#activePageIdCell;
  }

  /** Returns the page the canvas shows, or null while the scene has no page. */
  activePage(): PageNode | null {
    return this.nodeOfKind(this.#activePageIdCell.peek(), "page");
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

    this.#requestedPageId.set(pageId);
  }

  /**
   * Returns the active page, creating {@link DEFAULT_PAGE_NAME} first when the scene has none.
   *
   * @remarks
   * Also moves any root node that is not a page onto the active page, so a
   * scene written before pages existed keeps its content. Writes records, so
   * inside a capture the creation is part of that undo step.
   */
  ensurePage(): PageNode {
    const page =
      this.activePage() ??
      this.createNode<PageNode>({
        kind: "page",
        name: DEFAULT_PAGE_NAME,
        position: { x: 0, y: 0 },
      });
    for (const root of this.#nodesFor(this.#structureCell.peek().roots())) {
      if (root.kind === "page") continue;

      this.#store.put(copyNode({ ...root, parentId: page.id }) as ShiftNodeRecord);
    }

    return page;
  }

  /**
   * Returns the top-level node a node sits under: the node itself when it is
   * directly on a page, null for a page or a node on no page.
   *
   * @remarks
   * Reactive through {@link structureCell}: the reader reruns when the
   * structure changes.
   */
  topLevelOf(nodeId: NodeId): NodeId | null {
    track(this.#structureCell);
    const structure = this.#structureCell.peek();
    let topLevel: NodeId | null = null;
    let current: NodeId | null = nodeId;
    while (current !== null) {
      const parentId = structure.parent(current);
      if (parentId === null) return topLevel;
      topLevel = current;
      current = parentId;
    }
    return null;
  }

  /** Returns the page a node is on (the page itself for a page), or null for a node on no page. */
  pageOf(nodeId: NodeId): PageNode | null {
    const node = this.node(nodeId);
    if (!node) return null;
    if (node.kind === "page") return node;

    let root: ShiftNode = node;
    for (const ancestor of this.ancestors(nodeId)) root = ancestor;
    return root.kind === "page" ? root : null;
  }

  node(nodeId: NodeId | null): ShiftNode | null {
    if (!nodeId) return null;

    const record = this.#store.get(nodeId);
    return record?.type === "node" ? (record as ShiftNode) : null;
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
    return this.#nodesFor(this.#structureCell.peek().children(nodeId));
  }

  /** Returns a node's descendants on any page, parents before children. */
  descendants(nodeId: NodeId): readonly ShiftNode[] {
    return this.#nodesFor([...this.#structureCell.peek().descendants(nodeId)]);
  }

  /** Yields a node's ancestors, nearest first. */
  *ancestors(nodeId: NodeId): Iterable<ShiftNode> {
    for (const id of this.#structureCell.peek().ancestors(nodeId)) {
      const node = this.node(id);
      if (node) yield node;
    }
  }

  /** Returns a node's parent, or null for root nodes. */
  parent(nodeId: NodeId): ShiftNode | null {
    return this.node(this.#structureCell.peek().parent(nodeId));
  }

  /** Returns the node with `nodeId` when it is of `kind`, else null. */
  nodeOfKind<K extends NodeKind>(nodeId: NodeId | null, kind: K): NodeOfKind<K> | null {
    const node = this.node(nodeId);
    if (node?.kind !== kind) return null;

    return node as NodeOfKind<K>;
  }

  /** Returns every node of `kind` on the active page, parents before children. */
  nodesOfKind<K extends NodeKind>(kind: K): readonly NodeOfKind<K>[] {
    const ids = this.#idsByKind.peek().get(kind) ?? [];
    return this.#nodesFor(ids) as unknown as readonly NodeOfKind<K>[];
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

  /**
   * Replaces every node on every page.
   *
   * @remarks
   * Root nodes that are not pages move onto the first page, or onto a new
   * {@link DEFAULT_PAGE_NAME} when `nodes` has no page.
   */
  setNodes(nodes: readonly ShiftNode[]): void {
    this.#deleteNodes();

    for (const node of nodes) {
      this.#store.put(copyNode(node) as ShiftNodeRecord);
    }
    this.ensurePage();
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
    for (const node of this.allNodes()) {
      this.#store.delete(node.id);
    }
  }

  #nextIndex(parentId: NodeId | null): string {
    const tree = this.#structureCell.peek();
    const siblings = parentId ? tree.children(parentId) : tree.roots();
    const last = siblings.at(-1);

    return indexAfter(last ? (this.node(last)?.index ?? null) : null);
  }

  /** The current records of `ids`, skipping any that are gone. */
  #nodesFor(ids: Iterable<NodeId>): ShiftNode[] {
    const nodes: ShiftNode[] = [];
    for (const id of ids) {
      const node = this.node(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }
}

// Numeric-aware, so "a10" sorts after "a9".
const INDEX_COLLATOR = new Intl.Collator("en", { numeric: true });

/** Orders sibling `index` keys; digit runs compare as numbers. */
export function compareIndex(a: string, b: string): number {
  if (a === b) return 0;

  const order = INDEX_COLLATOR.compare(a, b);
  if (order !== 0) return order;
  return a < b ? -1 : 1;
}

/** Returns an index key that sorts after `last`, or the first key when there is no sibling. */
export function indexAfter(last: string | null): string {
  if (last === null) return "a0";

  const match = /^a(\d+)$/.exec(last);
  if (match?.[1]) return `a${Number(match[1]) + 1}`;
  return `${last}1`;
}

/** Whether a node record change adds, removes, reparents, or reorders a node. */
function changesStructure(
  before: ShiftEditorRecord | null,
  after: ShiftEditorRecord | null,
): boolean {
  const wasNode = before?.type === "node";
  const isNode = after?.type === "node";
  if (!wasNode && !isNode) return false;
  if (!wasNode || !isNode) return true;

  return before.parentId !== after.parentId || before.index !== after.index;
}

function sameNodes(a: readonly ShiftNode[], b: readonly ShiftNode[]): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

function copyNode<T extends ShiftNode>(node: T): T {
  return {
    ...node,
    position: { ...node.position },
  };
}
