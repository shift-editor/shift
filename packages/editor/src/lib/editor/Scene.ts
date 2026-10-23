import { mintNodeId, type NodeId } from "@shift/types";
import { Tree } from "../utils/Tree";
import {
  computed,
  effect,
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
  SceneGlyph,
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
  readonly #pageNodeIdsCell: Signal<readonly NodeId[]>;
  readonly #cell: Signal<SceneValue>;
  readonly #idsByKind: Signal<ReadonlyMap<NodeKind, readonly NodeId[]>>;
  readonly #glyphNodeIdsCell: Signal<readonly NodeId[]>;
  readonly #onlyGlyphCell: Signal<SceneGlyph | null>;
  readonly #firstGlyphCell: Signal<SceneGlyph | null>;
  readonly #byReference: StoreIndex<NodeReference, ShiftNodeRecord>;
  readonly #byParent: StoreIndex<NodeId, ShiftNodeRecord>;
  readonly #byKind: StoreIndex<NodeKind, ShiftNodeRecord>;
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
    // Lets a new node find its last sibling without rebuilding the structure after each write.
    this.#byParent = store.index("node", (node) => (node.parentId ? [node.parentId] : []));
    this.#byKind = store.index("node", (node) => [node.kind]);
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
    // The root pages in sibling order, read from the page records so adding other nodes leaves it alone.
    this.#pagesCell = computed(
      () =>
        (this.#byKind.get("page") as unknown as readonly PageNode[])
          .filter((page) => !page.parentId || !this.record(page.parentId))
          .toSorted((a, b) => compareIndex(a.index, b.index)),
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
    // Walks the page once per structure change, so a node write only looks records up.
    this.#pageNodeIdsCell = computed(
      () => {
        const tree = this.#structureCell.value;
        const pageId = this.#activePageIdCell.value;
        return pageId ? [...tree.descendants(pageId)] : [];
      },
      { name: "editor.scene.pageNodeIds" },
    );
    this.#cell = computed(
      () => {
        const ids = this.#pageNodeIdsCell.value;
        // Reruns on every node write, so readers of `cell` see moves and edits.
        this.#store.recordsOfType("node");
        return { nodes: this.#nodesFor(ids) };
      },
      { name: "editor.scene" },
    );
    this.#idsByKind = computed(
      () => {
        const ids = new Map<NodeKind, NodeId[]>();
        for (const id of this.#pageNodeIdsCell.value) {
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
    // Follows the glyph nodes and their ancestors' records, not the structure, so adding
    // text runs does not walk the page.
    this.#glyphNodeIdsCell = computed(
      () => {
        const pageId = this.#activePageIdCell.value;
        const placed: { id: NodeId; path: readonly string[] }[] = [];
        for (const node of this.#byKind.get("glyph")) {
          const place = this.#placeOf(node.id);
          if (place && place.pageId === pageId) placed.push({ id: node.id, path: place.path });
        }
        return placed.toSorted((a, b) => comparePaths(a.path, b.path)).map(({ id }) => id);
      },
      { name: "editor.scene.glyphNodeIds", equals: sameIds },
    );
    this.#onlyGlyphCell = computed(
      () => {
        const ids = this.#glyphNodeIdsCell.value;
        return ids.length === 1 ? this.#sceneGlyph(ids[0]!) : null;
      },
      { name: "editor.scene.onlyGlyph", equals: sameSceneGlyph },
    );
    this.#firstGlyphCell = computed(
      () => {
        const id = this.#glyphNodeIdsCell.value[0];
        return id ? this.#sceneGlyph(id) : null;
      },
      { name: "editor.scene.firstGlyph", equals: sameSceneGlyph },
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
    this.#byParent.dispose();
    this.#byKind.dispose();
  }

  /**
   * The ids of the active page's glyph nodes in scene order, as {@link nodesOfKind} lists them.
   *
   * @remarks
   * Reactive: readers rerun when a glyph node is added, removed, or reordered,
   * or the page switches. Adding, moving, or editing other nodes, and moving a
   * glyph node, do not notify them.
   */
  get glyphNodeIdsCell(): Signal<readonly NodeId[]> {
    return this.#glyphNodeIdsCell;
  }

  /**
   * The active page's one glyph node and the glyph it shows; null with none or several.
   *
   * @remarks
   * Reactive: readers rerun when a glyph node is added or removed, the page
   * switches, or the node starts showing another glyph. Moving it, or writing
   * any other node, does not notify them. Matches {@link only}.
   */
  get onlyGlyphCell(): Signal<SceneGlyph | null> {
    return this.#onlyGlyphCell;
  }

  /**
   * The active page's first glyph node in scene order and the glyph it shows; null with none.
   *
   * @remarks
   * Reactive like {@link onlyGlyphCell}. Matches {@link first}.
   */
  get firstGlyphCell(): Signal<SceneGlyph | null> {
    return this.#firstGlyphCell;
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

  /**
   * Keeps a cache keyed by node id free of deleted nodes, disposing each deleted node's entry.
   *
   * @remarks
   * Prunes once the change that deleted a node has finished, so a node deleted
   * and put back in one batch keeps its entry and the readers holding it.
   * Costs the deleted nodes only, never a walk of the scene.
   *
   * @param name - debug name for the pruning effect.
   * @returns a function that stops pruning; call it when the cache's owner is disposed.
   */
  pruneDeleted<T>(cache: Map<NodeId, T>, dispose: (entry: T) => void, name: string): () => void {
    // non-reactive: ids deleted since the last prune; `deletions` announces them
    const deleted = new Set<NodeId>();
    const deletions = signal(0, { name: `${name}.deletions` });
    const unsubscribe = this.#store.onChange((change) => {
      if (change.before?.type !== "node" || change.after) return;

      deleted.add(change.before.id);
      deletions.set(deletions.peek() + 1);
    });
    const pruner = effect(
      () => {
        track(deletions);
        for (const id of deleted) {
          const entry = cache.get(id);
          if (entry === undefined || this.#store.get(id)) continue;
          dispose(entry);
          cache.delete(id);
        }
        deleted.clear();
      },
      { name },
    );
    return () => {
      unsubscribe();
      pruner.dispose();
    };
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

  /** Yields a node's ancestors, nearest first; stops at a parent cycle. */
  *ancestors(nodeId: NodeId): Iterable<ShiftNode> {
    // Follows the records rather than the structure, so a lookup right after a write rebuilds nothing.
    const seen = new Set<NodeId>([nodeId]);
    let parent = this.parent(nodeId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      yield parent;
      parent = this.parent(parent.id);
    }
  }

  /** Returns a node's parent, or null for root nodes and nodes whose parent is missing. */
  parent(nodeId: NodeId): ShiftNode | null {
    return this.node(this.node(nodeId)?.parentId ?? null);
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
    if (!parentId) {
      const last = this.#structureCell.peek().roots().at(-1);
      return indexAfter(last ? (this.node(last)?.index ?? null) : null);
    }

    const siblings = untracked(() => this.#byParent.get(parentId));
    let last: string | null = null;
    for (const sibling of siblings) {
      if (last === null || compareIndex(sibling.index, last) > 0) last = sibling.index;
    }
    return indexAfter(last);
  }

  /**
   * The page a node is on and its sibling `index` at each level below the page, outermost first.
   *
   * @remarks
   * Reads the node's and its ancestors' records reactively. Sorting nodes by
   * path gives scene order. Null for a node on no page or under a parent cycle.
   */
  #placeOf(nodeId: NodeId): { pageId: NodeId; path: readonly string[] } | null {
    const path: string[] = [];
    const seen = new Set<NodeId>();
    let node = this.record(nodeId);
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      const parent = node.parentId ? this.record(node.parentId) : null;
      if (!parent) return node.kind === "page" ? { pageId: node.id, path: path.reverse() } : null;

      path.push(node.index);
      node = parent;
    }
    return null;
  }

  /** The glyph a glyph node shows, following that node's record only. */
  #sceneGlyph(nodeId: NodeId): SceneGlyph | null {
    const node = this.record(nodeId);
    return node?.kind === "glyph" ? { nodeId, glyphId: node.glyphId } : null;
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

/** Orders sibling-index paths depth-first: a parent's path sorts before its children's. */
function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let at = 0; at < Math.min(a.length, b.length); at++) {
    const order = compareIndex(a[at]!, b[at]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

function sameIds(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameSceneGlyph(a: SceneGlyph | null, b: SceneGlyph | null): boolean {
  return a === b || (a?.nodeId === b?.nodeId && a?.glyphId === b?.glyphId);
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
