import type { NodeId } from "@shift/types";
import { Bounds, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import { compareIndex } from "../editor/Scene";
import { computed, effect, signal, track, untracked } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import { loadShaping } from "../wasm/shaping";
import {
  EMPTY_PAGE_LAYOUT,
  layOutFrame,
  sameShape,
  sameSizing,
  type LayoutShape,
  type RunMeasure,
} from "./pageLayout";
import type { FrameNode, ShiftNode, TextRunNode } from "../../types/node";
import type {
  FrameAxis,
  FrameLayout,
  FrameMode,
  FrameOptions,
  LaidOutNode,
  LayoutPageFunction,
  PageLayout,
  PagePlacement,
  Sizing,
} from "../../types/frame";

/** A node's cached layout cells; disposed when the node leaves the scene. */
interface NodeCells {
  readonly shape: ComputedSignal<LayoutShape>;
  /** Independent of the active page, so a page switch leaves it valid. */
  readonly placement: ComputedSignal<PagePlacement>;
  readonly laidOut: ComputedSignal<LaidOutNode | null>;
  /** Present for a top-level frame: the layout of it and everything in it. */
  layout: ComputedSignal<PageLayout> | null;
}

/** A new frame's layout: a column with room around and between its children. */
export const DEFAULT_FRAME_LAYOUT: FrameLayout = {
  mode: "column",
  gap: 16,
  padding: { top: 16, right: 16, bottom: 16, left: 16 },
  align: "start",
  justify: "start",
};

const HUG: Sizing = { kind: "hug" };

/** Room left between a new frame or run and the content already on the page, in scene units. */
const PLACEMENT_GAP = 200;

/** Proof size of a text run added with {@link Frames.addText}. */
const DEFAULT_TEXT_SIZE = 72;

/**
 * Creates and edits auto layout frames, and lays out the active page.
 *
 * @remarks
 * Frames are scene nodes (`FrameNode`), so this is a view over `Scene` plus
 * the page layout. Each edit is one undo step (joining an open capture, such
 * as a tool gesture's).
 *
 * Layout is fine-grained: each top-level frame is laid out on its own, from
 * cells that hold what layout reads from each node (everything but its
 * position) and each run's measured size. Moving a frame on the page lays
 * nothing out, and editing inside one frame lays out that frame only.
 * Selection, hover, and caret changes never lay anything out.
 */
export class Frames {
  readonly #editor: Editor;
  readonly #engineCell: WritableSignal<LayoutPageFunction | null> = signal(null, {
    name: "editor.frames.engine",
  });
  #loading: Promise<void> | null = null;
  // non-reactive: cache of per-node cells, pruned by #pruner when nodes leave the scene
  readonly #cells = new Map<NodeId, NodeCells>();
  readonly #loader: Effect;
  readonly #stopPruning: () => void;

  /**
   * @param editor - editor whose scene holds the frames.
   */
  constructor(editor: Editor) {
    this.#editor = editor;
    const scene = editor.scene;
    // The engine ships in the shaping module; load it once the active page has a frame to lay
    // out. Once it has loaded the effect reads only the engine, so frame writes stop rerunning it.
    this.#loader = effect(
      () => {
        if (this.#engineCell.value) return;

        const pageId = scene.activePageIdCell.value;
        const frames = scene.allNodesOfKind("frame");
        if (frames.some((frame) => scene.pageOf(frame.id)?.id === pageId)) void this.#loadEngine();
      },
      { name: "editor.frames.loadEngine" },
    );
    this.#stopPruning = scene.pruneDeleted(this.#cells, disposeCells, "editor.frames.prune");
  }

  /**
   * Returns where the page layout put a node, or null for a node outside
   * frames or on another page.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when this
   * node's place changes. Null until the layout engine has loaded (see
   * {@link settled}).
   */
  laidOut(nodeId: NodeId): LaidOutNode | null {
    const cell = this.laidOutCell(nodeId);
    track(cell);
    return cell.peek();
  }

  /** The cell behind {@link laidOut}, for readers that subscribe to it directly. */
  laidOutCell(nodeId: NodeId): Signal<LaidOutNode | null> {
    return this.#cellsFor(nodeId).laidOut;
  }

  /** Resolves once the layout engine has loaded, when a page needed it. */
  async settled(): Promise<void> {
    await this.#loading;
  }

  /**
   * Adds an empty frame and returns it.
   *
   * @param parentId - a page or frame; null for the active page.
   * @param options - layout, sizing, name, and position on a page.
   * @returns null when the parent is not a page or frame.
   */
  create(parentId: NodeId | null = null, options: FrameOptions = {}): FrameNode | null {
    const parent = this.#container(parentId);
    if (!parent) return null;

    return this.#editor.history.captureOrJoin("Add frame", () =>
      this.#editor.scene.createNode<FrameNode>({
        kind: "frame",
        parentId: parent.id,
        name: options.name ?? this.#nextName(),
        layout: { ...DEFAULT_FRAME_LAYOUT, ...options.layout },
        width: options.width ?? HUG,
        height: options.height ?? HUG,
        position: options.position ?? this.#freeSpot(parent),
      }),
    );
  }

  /**
   * Adds a text run showing `text` and returns its node.
   *
   * @remarks
   * Creates a new run record, so the run's text is its own. On a page the run
   * goes below the page's content unless `position` is given; in a frame the
   * frame places it last.
   *
   * @param parentId - a page or frame; null for the active page.
   * @returns null when the parent is not a page or frame.
   */
  addText(
    parentId: NodeId | null,
    text: string,
    options: { readonly size?: number; readonly position?: Point2D } = {},
  ): TextRunNode | null {
    const parent = this.#container(parentId);
    if (!parent) return null;

    const editor = this.#editor;
    return editor.history.captureOrJoin("Add text", () => {
      const run = editor.text.createRun(editor.text.itemsFromText(text));
      return editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        parentId: parent.id,
        runId: run.id,
        size: options.size ?? DEFAULT_TEXT_SIZE,
        position: options.position ?? this.#freeSpot(parent),
      });
    });
  }

  /**
   * Wraps nodes that share a parent in a new frame at their place.
   *
   * @remarks
   * The frame takes the first node's place among its siblings and, on a page,
   * the top-left corner of the nodes' box; the nodes keep their order inside it.
   * Only text runs and frames can be wrapped.
   *
   * @returns null when `nodeIds` is empty, holds another kind, or spans parents.
   */
  wrap(nodeIds: readonly NodeId[], mode: FrameMode = "column"): FrameNode | null {
    const scene = this.#editor.scene;
    const nodes = nodeIds.map((id) => scene.node(id));
    const first = nodes[0];
    const parent = first ? this.#container(first.parentId) : null;
    if (!first || !parent) return null;
    for (const node of nodes) {
      if (!node || !isFrameChild(node) || node.parentId !== parent.id) return null;
    }

    const ordered = (nodes as ShiftNode[]).toSorted((a, b) => compareIndex(a.index, b.index));
    const leader = ordered[0]!;
    const position = this.#topLeft(ordered) ?? leader.position;
    return this.#editor.history.captureOrJoin("Wrap in frame", () => {
      const frame = scene.createNode<FrameNode>({
        kind: "frame",
        parentId: parent.id,
        index: leader.index,
        name: this.#nextName(),
        layout: { ...DEFAULT_FRAME_LAYOUT, mode },
        width: HUG,
        height: HUG,
        position,
      });
      ordered.forEach((node, at) => {
        scene.updateNode({ id: node.id, parentId: frame.id, index: `a${at}` });
      });
      return frame;
    });
  }

  /**
   * Changes how a frame places its children.
   *
   * @remarks
   * Unchanged values record no undo step.
   */
  setLayout(frameId: NodeId, layout: Partial<FrameLayout>): void {
    const frame = this.#editor.scene.nodeOfKind(frameId, "frame");
    if (!frame) return;

    const next = { ...frame.layout, ...layout };
    if (sameLayout(frame.layout, next)) return;

    this.#editor.history.captureOrJoin("Change frame layout", () => {
      this.#editor.scene.updateNode({ id: frameId, layout: next });
    });
  }

  /** Sets one of a frame's sizes to fixed, hug, or fill. */
  setSizing(frameId: NodeId, axis: FrameAxis, sizing: Sizing): void {
    const frame = this.#editor.scene.nodeOfKind(frameId, "frame");
    if (!frame || sameSizing(frame[axis], sizing)) return;

    this.#editor.history.captureOrJoin("Resize frame", () => {
      this.#editor.scene.updateNode({ id: frameId, [axis]: sizing });
    });
  }

  /**
   * Moves a node to `index` among its siblings in a frame.
   *
   * @param index - position after the move; clamped to the siblings.
   */
  moveChild(nodeId: NodeId, index: number): void {
    const scene = this.#editor.scene;
    const node = scene.node(nodeId);
    const parent = scene.nodeOfKind(node?.parentId ?? null, "frame");
    if (!node || !parent) return;

    const siblings = scene.children(parent.id);
    const from = siblings.findIndex((sibling) => sibling.id === nodeId);
    const others = siblings.filter((sibling) => sibling.id !== nodeId);
    const to = Math.max(0, Math.min(Math.trunc(index), others.length));
    if (to === from) return;

    const ordered = [...others.slice(0, to), node, ...others.slice(to)];
    this.#editor.history.captureOrJoin("Reorder frame", () => {
      ordered.forEach((sibling, at) => {
        const key = `a${at}`;
        if (sibling.index !== key) scene.updateNode({ id: sibling.id, index: key });
      });
    });
  }

  /**
   * Deletes a frame and everything in it.
   *
   * @remarks
   * Text runs placed only inside the frame are deleted with it, as when a page is deleted.
   *
   * @returns false when `frameId` is not a frame.
   */
  delete(frameId: NodeId): boolean {
    const editor = this.#editor;
    const scene = editor.scene;
    if (!scene.nodeOfKind(frameId, "frame")) return false;

    editor.history.captureOrJoin("Delete frame", () => {
      const nodes = scene.descendants(frameId);
      const deleted = new Set([frameId, ...nodes.map((node) => node.id)]);
      for (const node of [...nodes].reverse()) scene.deleteNode(node.id);
      scene.deleteNode(frameId);
      if (editor.selection.has(frameId)) editor.selection.remove(frameId);

      for (const node of nodes) {
        if (node.kind !== "textRun") continue;
        const elsewhere = scene
          .nodesReferencing(node.runId)
          .some((other) => !deleted.has(other.id));
        if (!elsewhere) editor.text.deleteRun(node.runId);
      }
    });
    return true;
  }

  dispose(): void {
    this.#loader.dispose();
    this.#stopPruning();
    for (const cells of this.#cells.values()) disposeCells(cells);
    this.#cells.clear();
  }

  #cellsFor(nodeId: NodeId): NodeCells {
    let cells = this.#cells.get(nodeId);
    if (cells) return cells;

    const shape = computed(() => this.#shape(nodeId), {
      name: "editor.frames.shape",
      equals: sameShape,
    });
    const placement = computed(() => this.#placement(nodeId), {
      name: "editor.frames.placement",
      equals: samePlacement,
    });
    // Switching pages reruns this for every node, so it only compares page ids.
    const laidOut = computed(
      () => {
        const { pageId, laidOut } = placement.value;
        return pageId && pageId === this.#editor.scene.activePageIdCell.value ? laidOut : null;
      },
      { name: "editor.frames.laidOut", equals: sameLaidOut },
    );
    cells = { shape, placement, laidOut, layout: null };
    this.#cells.set(nodeId, cells);
    return cells;
  }

  /** What layout reads from a node: a frame's layout and sizing, or a run's measured size. */
  #shape(nodeId: NodeId): LayoutShape {
    const node = this.#editor.scene.record(nodeId);
    switch (node?.kind) {
      case "frame":
        return { kind: "frame", layout: node.layout, width: node.width, height: node.height };
      case "textRun":
        return this.#measureRun(node);
      default:
        return null;
    }
  }

  /** Where the layout of the node's top-level frame put it, on whichever page. */
  #placement(nodeId: NodeId): PagePlacement {
    const scene = this.#editor.scene;
    track(scene.structureCell);
    const structure = scene.structureCell.peek();
    let rootId = nodeId;
    let pageId = structure.parent(nodeId);
    for (const ancestorId of structure.ancestors(nodeId)) {
      if (structure.parent(ancestorId) === null) {
        pageId = ancestorId;
        break;
      }
      rootId = ancestorId;
    }
    if (!pageId) return NO_PLACEMENT;

    const layout = this.#rootLayout(rootId);
    track(layout);
    return { pageId, laidOut: layout.peek().get(nodeId) ?? null };
  }

  #rootLayout(rootId: NodeId): ComputedSignal<PageLayout> {
    const cells = this.#cellsFor(rootId);
    cells.layout ??= computed(
      () => {
        const engine = this.#engineCell.value;
        if (!engine) return EMPTY_PAGE_LAYOUT;

        const structure = this.#editor.scene.structureCell.value;
        return layOutFrame(structure, rootId, (id) => this.#cellsFor(id).shape.value, engine);
      },
      { name: "editor.frames.layout" },
    );
    return cells.layout;
  }

  /**
   * Measures a text run as a fixed leaf: its drawn box in scene units, and its
   * origin (the first baseline's start) from the box's top-left corner.
   */
  #measureRun(run: TextRunNode): RunMeasure {
    const editor = this.#editor;
    track(editor.text.layoutCell(run.runId));
    track(editor.font.metricsCell);
    const unitsPerEm = editor.font.metricsCell.peek().unitsPerEm;
    const bounds = editor.nodeDefinition("textRun").bounds(run);
    if (!bounds) return { kind: "textRun", size: { width: 0, height: 0 }, offset: { x: 0, y: 0 } };

    const scale = run.size / unitsPerEm;
    return {
      kind: "textRun",
      size: {
        width: (bounds.max.x - bounds.min.x) * scale,
        height: (bounds.max.y - bounds.min.y) * scale,
      },
      // The run draws Y-up from its baseline, so its box top is `max.y` above the origin.
      offset: { x: -bounds.min.x * scale, y: bounds.max.y * scale },
    };
  }

  #loadEngine(): Promise<void> {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  async #load(): Promise<void> {
    try {
      const { layoutPage } = await loadShaping();
      this.#engineCell.set(layoutPage);
    } catch (error) {
      this.#loading = null;
      console.error("failed to load the layout engine", error);
    }
  }

  /** Returns a page or frame by id, or the active page for null. */
  #container(nodeId: NodeId | null): ShiftNode | null {
    const scene = this.#editor.scene;
    const node = nodeId ? scene.node(nodeId) : scene.activePage();
    if (node?.kind !== "page" && node?.kind !== "frame") return null;

    return node;
  }

  /** Below the content already on a page; the origin inside a frame, which places children itself. */
  #freeSpot(parent: ShiftNode): Point2D {
    if (parent.kind !== "page") return { x: 0, y: 0 };

    const bounds = this.#sceneBounds(this.#editor.scene.children(parent.id));
    if (!bounds) return { x: 0, y: 0 };

    return { x: bounds.min.x, y: bounds.max.y + PLACEMENT_GAP };
  }

  /** The top-left corner of the nodes' scene box, or null when none has bounds. */
  #topLeft(nodes: readonly ShiftNode[]): Point2D | null {
    const bounds = this.#sceneBounds(nodes);
    return bounds ? { x: bounds.min.x, y: bounds.min.y } : null;
  }

  #sceneBounds(nodes: readonly ShiftNode[]): BoundsType | null {
    return Bounds.unionAll(nodes.map((node) => this.#editor.nodeBounds(node)));
  }

  #nextName(): string {
    const scene = this.#editor.scene;
    const pageId = scene.activePageIdCell.peek();
    const names = new Set(
      untracked(() => scene.allNodesOfKind("frame"))
        .filter((frame) => scene.pageOf(frame.id)?.id === pageId)
        .map((frame) => frame.name),
    );
    let number = names.size + 1;
    while (names.has(`Frame ${number}`)) number += 1;

    return `Frame ${number}`;
  }
}

/** Whether a node can sit in a frame: a text run or another frame. */
function isFrameChild(node: ShiftNode): node is TextRunNode | FrameNode {
  return node.kind === "textRun" || node.kind === "frame";
}

function disposeCells(cells: NodeCells): void {
  cells.shape.dispose();
  cells.laidOut.dispose();
  cells.placement.dispose();
  cells.layout?.dispose();
}

const NO_PLACEMENT: PagePlacement = { pageId: null, laidOut: null };

function samePlacement(a: PagePlacement, b: PagePlacement): boolean {
  return a.pageId === b.pageId && sameLaidOut(a.laidOut, b.laidOut);
}

function sameLaidOut(a: LaidOutNode | null, b: LaidOutNode | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.box.x === b.box.x &&
    a.box.y === b.box.y &&
    a.box.width === b.box.width &&
    a.box.height === b.box.height &&
    a.origin.x === b.origin.x &&
    a.origin.y === b.origin.y
  );
}

function sameLayout(a: FrameLayout, b: FrameLayout): boolean {
  return (
    a.mode === b.mode &&
    a.gap === b.gap &&
    a.align === b.align &&
    a.justify === b.justify &&
    a.padding.top === b.padding.top &&
    a.padding.right === b.padding.right &&
    a.padding.bottom === b.padding.bottom &&
    a.padding.left === b.padding.left
  );
}
