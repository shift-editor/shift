import {
  EntityMap,
  mintNodeId,
  type NodeId,
  type ReadonlyEntityMap,
  type RunId,
  type SourceId,
} from "@shift/types";
import { Tree } from "../utils/Tree";
import {
  computed,
  keyedCache,
  signal,
  track,
  type Signal,
  type WritableSignal,
} from "../signals/index";
import type { NodeReference } from "../../types/records";
import {
  sameNodeList,
  type CreateNode,
  type PageNode,
  type NodeKind,
  type NodeOfKind,
  type ShiftNode,
  type UpdateNode,
} from "../../types/node";
import type { TextRunRecord } from "../../types/text";
import type { TextItem } from "../text/layout/types";
import type {
  RunSettings,
  SceneDocument,
  SceneIntent,
  SceneRecording,
} from "../../types/sceneDocument";
import { IndexKey } from "../../types/indexKey";
import { SceneNodes } from "./sceneNodes";

/** Name given to the page a scene gets when it has none. */
export const DEFAULT_PAGE_NAME = "Page 1";

export interface SceneValue {
  /** The nodes on the active page, parents before children, siblings by `index`; the page itself is not included. */
  readonly nodes: readonly ShiftNode[];
  /** Every node on every page. */
  readonly tree: Tree<NodeId, ShiftNode>;
}

/** The document's nodes as the editor reads them, rebuilt after each scene change. */
interface DocumentValue {
  /** Every node, parents before children, siblings by `index`. */
  readonly nodes: readonly ShiftNode[];
  readonly tree: Tree<NodeId, ShiftNode>;
  /** Each text run's content, by run id. */
  readonly runs: ReadonlyMap<RunId, TextRunRecord>;
  /** The node that holds each run. */
  readonly runNodes: ReadonlyMap<RunId, NodeId>;
  /** The source each glyph node was placed with, as the document stores it. */
  readonly storedSources: ReadonlyMap<NodeId, SourceId>;
}

/** What a {@link Scene} needs from its editor. */
export interface SceneOptions {
  /** What a node depends on: its definition's `references`. */
  readonly references: (node: ShiftNode) => readonly NodeReference[];
  /** Whether a write made now is an undo step: not inside `EditorHistory.withoutRecording`. */
  readonly recording: () => SceneRecording;
  /** Told which nodes, and which runs' content, each write changed, as a history capture notes them. */
  readonly changed: (ids: readonly NodeReference[]) => void;
}

/**
 * Exposes the document's placed node graph: its pages, text runs and placed
 * glyphs.
 *
 * Scene is the editor's API over the scene a {@link SceneDocument} holds: in
 * a workspace, the window's editing engine, which keeps the scene beside the
 * font, records each write in the one undo history and saves it as it is made.
 * Reads come from the document, once per scene change; writes are scene
 * intents.
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
  readonly #document: SceneDocument;
  readonly #recording: () => SceneRecording;
  readonly #changed: (ids: readonly NodeReference[]) => void;
  readonly #documentCell: Signal<DocumentValue>;
  readonly #pagesCell: Signal<readonly PageNode[]>;
  readonly #requestedPageIdCell: WritableSignal<NodeId | null>;
  readonly #shownPageIdCell: Signal<NodeId | null>;
  readonly #shownPageCell: Signal<PageNode | null>;
  readonly #pageIdByNodeCell: Signal<ReadonlyMap<NodeId, NodeId>>;
  readonly #cell: Signal<SceneValue>;
  readonly #nodesById: Signal<ReadonlyEntityMap<NodeId, ShiftNode>>;
  readonly #nodesByKind: Signal<ReadonlyMap<NodeKind, readonly ShiftNode[]>>;
  readonly #byReferenceCell: Signal<ReadonlyMap<NodeReference, readonly ShiftNode[]>>;
  readonly #runsCell: Signal<ReadonlyMap<RunId, TextRunRecord>>;
  readonly #onlyCellsByKind = new Map<NodeKind, Signal<ShiftNode | null>>();
  readonly #nodes = new SceneNodes();
  /** The source each glyph node shows this session, where it differs from the one it was placed with. */
  readonly #shownSourcesCell: WritableSignal<ReadonlyMap<NodeId, SourceId>> = signal(new Map(), {
    name: "editor.scene.shownSources",
  });
  readonly #referencing = keyedCache({
    name: "editor.scene.referencing",
    key: (id: NodeReference) => id,
    create: (idCell: Signal<NodeReference>) =>
      computed(() => this.#byReferenceCell.value.get(idCell.value) ?? NO_NODES, {
        name: "editor.scene.referencingOne",
        equals: sameNodeList,
      }),
  });
  readonly #runCells = keyedCache({
    name: "editor.scene.run",
    key: (id: RunId) => id,
    create: (idCell: Signal<RunId>) =>
      computed(() => this.#documentCell.value.runs.get(idCell.value) ?? null, {
        name: "editor.scene.runOne",
      }),
  });

  constructor(document: SceneDocument, options: SceneOptions) {
    const references = options.references;
    this.#document = document;
    this.#recording = options.recording;
    this.#changed = options.changed;
    this.#documentCell = computed(
      () => {
        track(this.#document.revisionCell);
        const { nodes, runs, runNodes, storedSources } = this.#nodes.read(
          this.#document.nodes(),
          this.#shownSourcesCell.value,
        );
        // The document lists every node in tree order already.
        const tree = Tree.from<NodeId, ShiftNode>(nodes, {
          id: (node) => node.id,
          parentId: (node) => node.parentId,
        });
        return { nodes: tree.walk(), tree, runs, runNodes, storedSources };
      },
      { name: "editor.scene.document" },
    );
    this.#pagesCell = computed(
      () => this.#documentCell.value.tree.roots().filter((node) => node.kind === "page"),
      // Most node writes touch no page; keep the list's identity so a pages list does not rerender.
      { name: "editor.scene.pages", equals: sameNodeList },
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
    this.#document.followShownPage(() => this.#shownPageIdCell.peek());
    this.#shownPageCell = computed(
      () => {
        const shownPageId = this.#shownPageIdCell.value;
        return this.#pagesCell.value.find((page) => page.id === shownPageId) ?? null;
      },
      { name: "editor.scene.shownPageRecord" },
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
    this.#nodesByKind = computed(() => Map.groupBy(this.#cell.value.nodes, (node) => node.kind), {
      name: "editor.scene.nodesByKind",
    });
    this.#runsCell = computed(() => this.#documentCell.value.runs, { name: "editor.scene.runs" });
    this.#byReferenceCell = computed(
      () => {
        const byReference = new Map<NodeReference, ShiftNode[]>();
        for (const node of this.#documentCell.value.nodes) {
          for (const reference of references(node)) {
            const list = byReference.get(reference);
            if (list) list.push(node);
            else byReference.set(reference, [node]);
          }
        }
        return byReference;
      },
      { name: "editor.scene.byReference" },
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
   * For code that owns the whole document.
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
   * and keeps each page's camera. Each edit's undo step records it as where
   * the edit was made.
   */
  get shownPageIdCell(): Signal<NodeId | null> {
    return this.#shownPageIdCell;
  }

  /** The page the canvas shows, as a record: readers rerun on a page switch or a rename. */
  get shownPageCell(): Signal<PageNode | null> {
    return this.#shownPageCell;
  }

  /** Returns the page the canvas shows, or null while the scene has no page. */
  shownPage(): PageNode | null {
    return this.#shownPageCell.peek();
  }

  /**
   * Shows a page on the canvas.
   *
   * @remarks
   * Navigation only: writes nothing, so it is never an undo step. Callers
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
   * Writes to the document when it creates the page, so inside a capture the
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
   * Returns the nodes that depend on a run or glyph.
   *
   * @remarks
   * A node depends on whatever its definition's `references` names: a text
   * run node on its run, a glyph node on its glyph. Reactive: inside a
   * computed or effect, the reader reruns only when the nodes filed under `id`
   * change.
   */
  nodesReferencing(id: NodeReference): readonly ShiftNode[] {
    const cell = this.#referencing.get(id);
    track(cell);
    return cell.peek();
  }

  /**
   * Returns a text run's content, or null for a run no node places.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when this
   * run's items change.
   */
  run(runId: RunId): TextRunRecord | null {
    const cell = this.#runCells.get(runId);
    track(cell);
    return cell.peek();
  }

  /**
   * Every text run's content, by run id.
   *
   * @remarks
   * Reactive: a new map after each scene change; a run whose items are
   * unchanged keeps its record.
   */
  get runsCell(): Signal<ReadonlyMap<RunId, TextRunRecord>> {
    return this.#runsCell;
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
   * Creates a placed scene node and returns it.
   *
   * @remarks
   * A node other than a page created without a parent goes on the active page
   * (see {@link ensurePage}). A text run starts with `items`.
   *
   * @param node - Kind-specific node fields plus placement; identity, parent,
   * and ordering fields are optional.
   * @param items - A text run's items; none for any other kind.
   * @returns the node as the document now holds it.
   * @throws When the document refuses the node, as for a parent that does not exist.
   */
  createNode<N extends ShiftNode>(node: CreateNode<N>, items: readonly TextItem[] = []): N {
    const parentId = node.parentId ?? (node.kind === "page" ? null : this.ensurePage().id);
    const next = {
      ...node,
      id: node.id ?? mintNodeId(),
      type: "node",
      parentId,
      index: node.index ?? this.#nextIndex(parentId),
      position: { ...node.position },
    } as unknown as N;

    this.#apply([{ kind: "createNode", createNode: SceneNodes.toDocument(next, items) }], [next]);
    return (this.node(next.id) as N | null) ?? next;
  }

  /**
   * Replaces every node on every page.
   *
   * @remarks
   * Text runs start empty; their items are set through `Text`.
   */
  setNodes(nodes: readonly ShiftNode[]): void {
    const roots = this.#documentCell.peek().tree.roots();
    const intents: SceneIntent[] = roots.map((root) => ({
      kind: "deleteNode",
      deleteNode: { id: root.id },
    }));
    for (const node of parentsFirst(nodes)) {
      intents.push({ kind: "createNode", createNode: SceneNodes.toDocument(node, []) });
    }
    this.#apply(intents, [...this.allNodes(), ...nodes]);
  }

  /**
   * Updates mutable fields on an existing scene node.
   *
   * @param update - mutable node fields to merge into the current node.
   */
  updateNode(update: UpdateNode): void {
    const node = this.node(update.id);
    if (!node) return;

    const { shown, stored } = this.#splitShownSource(node, update);
    if (shown) this.#showSource(node.id, shown);
    if (!stored) return;

    // An update keeps a run's items, so none are sent.
    const next = { ...node, ...stored } as ShiftNode;
    this.#apply([{ kind: "updateNode", updateNode: SceneNodes.toDocument(next) }], [next]);
  }

  /**
   * Splits an update into the source a glyph node is to show, which is
   * session state like the shown page, and the fields the document stores;
   * `stored` is null when the update changes nothing stored.
   */
  #splitShownSource(
    node: ShiftNode,
    update: UpdateNode,
  ): { readonly shown: SourceId | null; readonly stored: UpdateNode | null } {
    if (node.kind !== "glyph" || !("sourceId" in update) || update.sourceId === undefined) {
      return { shown: null, stored: update };
    }

    const { sourceId, ...rest } = update;
    const stored = this.#storedSourceId(node.id);
    const changesStored = Object.keys(rest).some((key) => key !== "id");
    return {
      shown: sourceId,
      stored: changesStored ? ({ ...rest, sourceId: stored ?? sourceId } as UpdateNode) : null,
    };
  }

  /** The source a glyph node was placed with, as the document stores it. */
  #storedSourceId(nodeId: NodeId): SourceId | null {
    return this.#documentCell.peek().storedSources.get(nodeId) ?? null;
  }

  /** Shows `sourceId` in a glyph node for the rest of the session, writing nothing. */
  #showSource(nodeId: NodeId, sourceId: SourceId): void {
    const current = this.#shownSourcesCell.peek();
    const stored = this.#storedSourceId(nodeId) === sourceId;
    // Already shown: a write would only notify readers, which may write again.
    if (stored ? !current.has(nodeId) : current.get(nodeId) === sourceId) return;

    const next = new Map(current);
    if (stored) next.delete(nodeId);
    else next.set(nodeId, sourceId);
    this.#shownSourcesCell.set(next);
  }

  /**
   * Replaces the items of the run a text run node places.
   *
   * @returns false when no node places `runId`.
   */
  setRunItems(runId: RunId, items: readonly TextItem[]): boolean {
    const node = this.node(this.#documentCell.peek().runNodes.get(runId) ?? null);
    if (!node) return false;

    this.#apply([{ kind: "setRunItems", setRunItems: { id: node.id, items: [...items] } }], [node]);
    return true;
  }

  /**
   * Replaces how the run a text run node places is shaped and set.
   *
   * @returns false when no node places `runId`.
   */
  setRunSettings(runId: RunId, settings: RunSettings): boolean {
    const node = this.node(this.#documentCell.peek().runNodes.get(runId) ?? null);
    if (!node) return false;

    this.#apply([{ kind: "setRunSettings", setRunSettings: { id: node.id, settings } }], [node]);
    return true;
  }

  /** Deletes a node and everything under it. */
  deleteNode(nodeId: NodeId): void {
    this.deleteSubtree(nodeId);
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
    this.#apply([{ kind: "deleteNode", deleteNode: { id: nodeId } }], deleted);
    return deleted;
  }

  clear(): void {
    this.setNodes([]);
  }

  /** Applies `intents` to the document as one write, and notes the nodes it changes. */
  #apply(intents: readonly SceneIntent[], touched: readonly ShiftNode[]): void {
    if (intents.length === 0) return;

    this.#document.apply(intents, this.#recording());
    this.#changed(
      touched.flatMap((node): NodeReference[] =>
        node.kind === "textRun" ? [node.id, node.runId] : [node.id],
      ),
    );
  }

  #nextIndex(parentId: NodeId | null): string {
    const { tree } = this.#documentCell.peek();
    const siblings = parentId ? tree.children(parentId) : tree.roots();

    return IndexKey.between(siblings.at(-1)?.index ?? null, null);
  }
}

const NO_NODES: readonly ShiftNode[] = [];

/** `nodes` ordered so that each comes after its parent, when its parent is among them. */
function parentsFirst(nodes: readonly ShiftNode[]): readonly ShiftNode[] {
  const tree = Tree.from<NodeId, ShiftNode>(nodes, {
    id: (node) => node.id,
    parentId: (node) => node.parentId,
  });
  return tree.walk();
}
