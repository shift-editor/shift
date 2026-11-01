import type { NodeId } from "@shift/types";
import type { Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import { computed, type Signal } from "../signals";
import { sameNodeList, type PageNode } from "../../types/node";
import { IndexKey } from "../../types/indexKey";
import type { PageCamera } from "../../types/page";

/**
 * Lists, creates, edits, and switches the document's pages.
 *
 * @remarks
 * Pages are root scene nodes, so this is a view over `Scene` plus per-page
 * session state: the cameras. `Scene.shownPageIdCell` is the one owner of the
 * shown page; {@link activate} switches it through `Scene.showPage`. Page
 * edits (`create`, `rename`, `move`, `delete`) write scene records inside a
 * history capture, one undo step each. Switching pages is navigation: it
 * writes no record and is never undone.
 */
export class Pages {
  readonly #editor: Editor;
  // non-reactive: session camera memory, read only when a page is activated.
  readonly #cameras = new Map<NodeId, PageCamera>();

  readonly #listCell: Signal<readonly PageNode[]>;

  /**
   * @param editor - editor whose scene holds the pages.
   */
  constructor(editor: Editor) {
    this.#editor = editor;
    this.#listCell = computed(
      () => editor.scene.pagesCell.value.filter((page) => page.role !== "glyph"),
      { name: "editor.pages.list", equals: sameNodeList },
    );
  }

  /**
   * The user's pages in list order, glyph pages left out; keeps its identity
   * until a page record changes, so a list can render from it.
   */
  get listCell(): Signal<readonly PageNode[]> {
    return this.#listCell;
  }

  /** The user's pages in list order, glyph pages left out. */
  get list(): readonly PageNode[] {
    return this.#listCell.peek();
  }

  /**
   * Adds a glyph page and returns it. Does not show it.
   *
   * @remarks
   * A page the pages list leaves out (`PageNode.role`), for a glyph opened
   * outside the user's pages, such as in its own tab. Writes a record, so call
   * it inside `history.withoutRecording` when it is navigation.
   */
  createGlyphPage(): PageNode {
    return this.#editor.scene.createNode<PageNode>({
      kind: "page",
      name: "Glyph",
      role: "glyph",
      position: { x: 0, y: 0 },
      index: IndexKey.between(this.#editor.scene.pages().at(-1)?.index ?? null, null),
    });
  }

  /**
   * Removes a glyph page and everything on it, as navigation: no undo step.
   *
   * @remarks
   * For closing what showed it, such as a glyph tab. Text runs placed only on
   * the page go with it. Does nothing for one of the user's pages, which only
   * {@link Pages.delete} removes.
   */
  discardGlyphPage(pageId: NodeId): void {
    const page = this.#editor.scene.nodeOfKind(pageId, "page");
    if (page?.role !== "glyph") return;

    if (this.#editor.scene.shownPageIdCell.peek() === pageId) {
      const fallback = this.list[0];
      if (fallback) this.activate(fallback.id);
    }
    this.#editor.history.withoutRecording(() => this.#removePage(pageId));
    this.#cameras.delete(pageId);
  }

  /**
   * Returns the shown page, creating "Page 1" when the scene has none.
   *
   * @remarks
   * Writes a record when it creates the page, so call it inside
   * `history.withoutRecording` when it is setup rather than an edit.
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
        index: IndexKey.between(this.#editor.scene.pages().at(-1)?.index ?? null, null),
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
   * @remarks
   * Writes only the moved page: its new key sorts between its new neighbours.
   *
   * @param index - position among the pages after the move; clamped to the list.
   */
  move(pageId: NodeId, index: number): void {
    const pages = this.list;
    const from = pages.findIndex((page) => page.id === pageId);
    if (from < 0) return;

    const others = pages.filter((candidate) => candidate.id !== pageId);
    const to = Math.max(0, Math.min(Math.trunc(index), others.length));
    if (to === from) return;

    const key = IndexKey.between(others[to - 1]?.index ?? null, others[to]?.index ?? null);
    this.#editor.history.capture("Move page", () => {
      this.#editor.scene.updateNode({ id: pageId, index: key });
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
    if (neighbour && this.#editor.scene.shownPageIdCell.peek() === pageId) {
      this.activate(neighbour.id);
    }

    this.#editor.history.capture("Delete page", () => this.#removePage(pageId));
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
    const current = scene.shownPageIdCell.peek();
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

  /** Removes a page and everything on it; text runs' content goes with their nodes. */
  #removePage(pageId: NodeId): void {
    this.#editor.scene.deleteSubtree(pageId);
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
