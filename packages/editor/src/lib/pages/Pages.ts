import type { NodeId } from "@shift/types";
import type { Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import { indexAfter } from "../editor/Scene";
import { computed, type Signal } from "../signals";
import type { PageNode } from "../../types/node";
import type { PageCamera } from "../../types/page";

/**
 * Lists, creates, edits, and switches the document's pages.
 *
 * @remarks
 * Pages are root scene nodes, so this is a view over `Scene` plus per-page
 * session state. Page edits (`create`, `rename`, `move`, `delete`) write scene
 * records inside a history capture, one undo step each. Switching pages
 * (`activate`) is navigation: it writes no record and is never undone.
 */
export class Pages {
  readonly #editor: Editor;
  // non-reactive: session camera memory, read only when a page is activated.
  readonly #cameras = new Map<NodeId, PageCamera>();

  /**
   * @param editor - editor whose scene holds the pages.
   */
  readonly #listCell: Signal<readonly PageNode[]>;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#listCell = computed(
      () => editor.scene.pagesCell.value.filter((page) => page.role !== "glyph"),
      { name: "editor.pages.list", equals: samePages },
    );
  }

  /**
   * The user's pages in list order, the glyph view's page left out; keeps its
   * identity until a page record changes, so a list can render from it.
   */
  get listCell(): Signal<readonly PageNode[]> {
    return this.#listCell;
  }

  /** The user's pages in list order, the glyph view's page left out. */
  get list(): readonly PageNode[] {
    return this.#listCell.peek();
  }

  /**
   * Returns the glyph view's page, creating it the first time.
   *
   * @remarks
   * A page that never shows in the pages list (`PageNode.role`), where a
   * glyph opened from the font overview is edited. Writes a record the first
   * time, so call it inside `history.withoutRecording` when it is navigation.
   */
  glyphView(): PageNode {
    const existing = this.#editor.scene.pages().find((page) => page.role === "glyph");
    if (existing) return existing;

    return this.#editor.scene.createNode<PageNode>({
      kind: "page",
      name: "Glyph",
      role: "glyph",
      position: { x: 0, y: 0 },
      index: indexAfter(this.#editor.scene.pages().at(-1)?.index ?? null),
    });
  }

  /**
   * The page the canvas shows; null only while the scene has no page.
   *
   * @remarks
   * Session state, never stored or undone. When the page shown is deleted, it
   * falls back to the first page.
   */
  get activeCell(): Signal<NodeId | null> {
    return this.#editor.scene.activePageIdCell;
  }

  /** The page the canvas shows, or null while the scene has no page. */
  get active(): PageNode | null {
    return this.#editor.scene.activePage();
  }

  /**
   * Returns the active page, creating "Page 1" when the scene has none.
   *
   * @remarks
   * Root nodes that are not pages move onto it. Writes records, so call it
   * inside `history.withoutRecording` when it is setup rather than an edit.
   */
  ensure(): PageNode {
    return this.#editor.scene.ensurePage();
  }

  /**
   * Adds an empty page after the last one and returns it. Does not show it.
   *
   * @param name - shown in the pages list; defaults to the first unused "Page N".
   */
  create(name?: string): PageNode {
    const pages = this.list;
    const pageName = name?.trim() || this.#nextName(pages);

    return this.#editor.history.capture("Add page", () =>
      this.#editor.scene.createNode<PageNode>({
        kind: "page",
        name: pageName,
        position: { x: 0, y: 0 },
        index: indexAfter(pages.at(-1)?.index ?? null),
      }),
    );
  }

  /**
   * Renames a page.
   *
   * @remarks
   * Surrounding whitespace is dropped. A blank or unchanged name changes
   * nothing and records no undo step.
   */
  rename(pageId: NodeId, name: string): void {
    const page = this.#editor.scene.nodeOfKind(pageId, "page");
    const trimmed = name.trim();
    if (!page || trimmed === "" || trimmed === page.name) return;

    this.#editor.history.capture("Rename page", () => {
      this.#editor.scene.updateNode({ id: pageId, name: trimmed });
    });
  }

  /**
   * Moves a page to `index` in the list order.
   *
   * @param index - position among the pages after the move; clamped to the list.
   */
  move(pageId: NodeId, index: number): void {
    const pages = this.list;
    const from = pages.findIndex((page) => page.id === pageId);
    const page = pages[from];
    if (!page) return;

    const others = pages.filter((candidate) => candidate.id !== pageId);
    const to = Math.max(0, Math.min(Math.trunc(index), others.length));
    if (to === from) return;

    const ordered = [...others.slice(0, to), page, ...others.slice(to)];
    this.#editor.history.capture("Move page", () => {
      ordered.forEach((candidate, position) => {
        const key = `a${position}`;
        if (candidate.index !== key)
          this.#editor.scene.updateNode({ id: candidate.id, index: key });
      });
    });
  }

  /**
   * Deletes a page and everything on it.
   *
   * @remarks
   * A document always has a page, so the last page cannot be deleted.
   * Deleting the page the canvas shows first shows its neighbour. Text runs
   * placed only on the page are deleted with it; undo restores them all.
   *
   * @returns false when nothing was deleted: the page is unknown or is the last one.
   */
  delete(pageId: NodeId): boolean {
    const pages = this.list;
    const at = pages.findIndex((page) => page.id === pageId);
    if (at < 0 || pages.length <= 1) return false;

    const neighbour = pages[at + 1] ?? pages[at - 1];
    if (neighbour && this.activeCell.peek() === pageId) this.activate(neighbour.id);

    const scene = this.#editor.scene;
    this.#editor.history.capture("Delete page", () => {
      const nodes = scene.descendants(pageId);
      const deleted = new Set(nodes.map((node) => node.id));
      for (const node of [...nodes].reverse()) scene.deleteNode(node.id);
      scene.deleteNode(pageId);

      for (const node of nodes) {
        if (node.kind !== "textRun") continue;
        const elsewhere = scene
          .nodesReferencing(node.runId)
          .some((other) => !deleted.has(other.id));
        if (!elsewhere) this.#editor.text.deleteRun(node.runId);
      }
    });
    this.#cameras.delete(pageId);
    return true;
  }

  /**
   * Shows a page, restoring the camera it had when last shown this session.
   *
   * @remarks
   * Leaves whatever was edited, selected, or hovered on the previous page and
   * resets the active tool. None of this is an undo step.
   */
  activate(pageId: NodeId): void {
    const scene = this.#editor.scene;
    const current = this.activeCell.peek();
    if (current === pageId || !scene.nodeOfKind(pageId, "page")) return;

    if (current) this.#cameras.set(current, this.#camera());
    this.#editor.history.withoutRecording(() => this.#editor.exitNodes());
    scene.showPage(pageId);
    this.#editor.toolManager.reset();

    const camera = this.#cameras.get(pageId);
    if (!camera) return;

    this.#editor.setZoom(camera.zoom);
    this.#editor.setPan(camera.pan);
  }

  /**
   * Returns the page a node is on.
   *
   * @returns the page itself for a page; null for an unknown node or one on no page.
   */
  pageOf(nodeId: NodeId): PageNode | null {
    return this.#editor.scene.pageOf(nodeId);
  }

  #camera(): PageCamera {
    const pan: Point2D = this.#editor.pan;
    return { pan: { x: pan.x, y: pan.y }, zoom: this.#editor.zoom };
  }

  #nextName(pages: readonly PageNode[]): string {
    const names = new Set(pages.map((page) => page.name));
    let number = pages.length + 1;
    while (names.has(`Page ${number}`)) number += 1;

    return `Page ${number}`;
  }
}

function samePages(a: readonly PageNode[], b: readonly PageNode[]): boolean {
  return a.length === b.length && a.every((page, index) => page === b[index]);
}
