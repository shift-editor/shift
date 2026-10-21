import type { NodeId } from "@shift/types";
import { Bounds, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import { compareIndex } from "../editor/Scene";
import { computed, effect, signal, track } from "../signals";
import type { Effect, Signal, WritableSignal } from "../signals";
import { loadShaping } from "../wasm/shaping";
import { EMPTY_PAGE_LAYOUT, layOutPage } from "./pageLayout";
import type { FrameNode, ShiftNode, TextRunNode } from "../../types/node";
import type {
  FrameAxis,
  FrameLayout,
  FrameMode,
  FrameOptions,
  LaidOutNode,
  LayoutPageFunction,
  PageLayout,
  Sizing,
} from "../../types/frame";

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
 * as a tool gesture's). The layout ({@link layoutCell}) is derived from node
 * records and text layouts only, so selection, hover, and caret changes never
 * lay the page out again.
 */
export class Frames {
  readonly #editor: Editor;
  readonly #engineCell: WritableSignal<LayoutPageFunction | null> = signal(null, {
    name: "editor.frames.engine",
  });
  #loading: Promise<void> | null = null;
  readonly #layoutCell: Signal<PageLayout>;
  readonly #loader: Effect;

  /**
   * @param editor - editor whose scene holds the frames.
   */
  constructor(editor: Editor) {
    this.#editor = editor;
    const scene = editor.scene;
    this.#layoutCell = computed(
      () => {
        const pageId = scene.activePageIdCell.value;
        const { tree } = scene.cell.value;
        const engine = this.#engineCell.value;
        if (!pageId || !engine) return EMPTY_PAGE_LAYOUT;

        return layOutPage(editor, tree, pageId, engine);
      },
      { name: "editor.frames.layout" },
    );
    // The engine ships in the shaping module; load it once a page has a frame to lay out.
    this.#loader = effect(
      () => {
        track(scene.cell);
        if (scene.nodesOfKind("frame").length > 0) void this.#loadEngine();
      },
      { name: "editor.frames.loadEngine" },
    );
  }

  /**
   * The active page's layout: every frame's box and every placed child's origin.
   *
   * @remarks
   * Empty until the layout engine has loaded (see {@link settled}); readers
   * rerun when it arrives. Reruns on node edits, page switches, and text
   * layout changes of runs inside frames.
   */
  get layoutCell(): Signal<PageLayout> {
    return this.#layoutCell;
  }

  /** Returns where the page layout put a node, or null for a node outside frames or on another page. */
  laidOut(nodeId: NodeId): LaidOutNode | null {
    return this.#layoutCell.peek().get(nodeId) ?? null;
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
    const names = new Set(this.#editor.scene.nodesOfKind("frame").map((frame) => frame.name));
    let number = names.size + 1;
    while (names.has(`Frame ${number}`)) number += 1;

    return `Frame ${number}`;
  }
}

/** Whether a node can sit in a frame: a text run or another frame. */
function isFrameChild(node: ShiftNode): node is TextRunNode | FrameNode {
  return node.kind === "textRun" || node.kind === "frame";
}

function sameSizing(a: Sizing, b: Sizing): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "fixed" || (b.kind === "fixed" && a.size === b.size);
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
