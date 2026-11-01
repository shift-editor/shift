import type { NodeId } from "@shift/types";
import type { Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import { computed, signal, type Signal, type WritableSignal } from "../signals";
import { sameNodeList, type PageNode } from "../../types/node";
import { IndexKey } from "../../types/indexKey";
import type { EditLocation } from "@shift/wasm/protocol";
import type { PageCamera } from "../../types/page";

/**
 * Lists, creates, edits, and switches the document's pages.
 *
 * @remarks
 * Pages are root scene nodes, so this is a view over `Scene` plus per-page
 * view state: the cameras, which the window keeps with its other view state
 * ({@link cameras}, {@link restoreCameras}) so they survive reopening.
 * `Scene.shownPageIdCell` is the one owner of the shown page; {@link activate}
 * switches it through `Scene.showPage`. Page edits (`create`, `rename`,
 * `move`, `delete`) write scene records inside a history capture, one undo
 * step each. Switching pages is navigation: it writes no record and is never
 * undone. An undo or redo shows the page it changed ({@link reveal}).
 */
export class Pages {
  readonly #editor: Editor;
  /** Each page's camera as last left; the shown page's moves with the view until it is left. */
  readonly #camerasCell: WritableSignal<ReadonlyMap<NodeId, PageCamera>>;
  // non-reactive: listeners for replayed edits, called imperatively by reveal
  readonly #revealListeners = new Set<(location: EditLocation) => void>();

  readonly #listCell: Signal<readonly PageNode[]>;

  /**
   * @param editor - editor whose scene holds the pages.
   */
  constructor(editor: Editor) {
    this.#editor = editor;
    this.#camerasCell = signal<ReadonlyMap<NodeId, PageCamera>>(new Map(), {
      name: "editor.pages.cameras",
    });
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

  /** Returns the user's page `pageId`, or null when no page in the list has that id. */
  page(pageId: NodeId): PageNode | null {
    return this.list.find((page) => page.id === pageId) ?? null;
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
    this.#forgetCamera(pageId);
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

    // The page keeps its camera, so undoing the delete shows it as it was left.
    this.#editor.history.capture("Delete page", () => this.#removePage(pageId));
    return true;
  }

  /**
   * Calls `listener` with where each undo or redo was made, after its page
   * is shown, so the window can show the tab that holds it.
   *
   * @returns a function that stops the calls.
   */
  onReveal(listener: (location: EditLocation) => void): () => void {
    this.#revealListeners.add(listener);
    return () => this.#revealListeners.delete(listener);
  }

  /**
   * Shows the page an undo or redo changed, before the change is drawn.
   *
   * @remarks
   * Called by the document as it replays a step. Leaves the canvas alone
   * when the page is gone, as after undoing its creation, but still tells
   * the {@link onReveal} listeners, since the location's glyphs can reopen a
   * closed glyph tab.
   */
  reveal(location: EditLocation): void {
    if (location.pageId) this.activate(location.pageId);
    for (const listener of this.#revealListeners) listener(location);
  }

  /**
   * The cameras pages were left with, changing when a page is left or the
   * window restores them; with the view's pan and zoom, what {@link cameras}
   * answers.
   */
  get camerasCell(): Signal<ReadonlyMap<NodeId, PageCamera>> {
    return this.#camerasCell;
  }

  /**
   * Each page's camera, as last left, the shown page's as it is now; pages
   * no longer in the scene are left out.
   */
  cameras(): ReadonlyMap<NodeId, PageCamera> {
    const scene = this.#editor.scene;
    const cameras = new Map<NodeId, PageCamera>();
    for (const [pageId, camera] of this.#camerasCell.peek()) {
      if (scene.nodeOfKind(pageId, "page")) cameras.set(pageId, camera);
    }
    const shown = scene.shownPageIdCell.peek();
    if (shown) cameras.set(shown, this.#camera());
    return cameras;
  }

  /**
   * Takes back the cameras a window kept, dropping those of pages that no
   * longer exist, and puts the shown page's camera back at once.
   */
  restoreCameras(cameras: ReadonlyMap<NodeId, PageCamera>): void {
    const scene = this.#editor.scene;
    const kept = new Map(
      [...cameras].filter(([pageId]) => scene.nodeOfKind(pageId, "page") !== null),
    );
    this.#camerasCell.set(kept);
    const shown = scene.shownPageIdCell.peek();
    const camera = shown ? kept.get(shown) : undefined;
    if (camera) this.#apply(camera);
  }

  /** Whether `pageId` has a camera to show it with, so showing it should not refit the view. */
  remembersCamera(pageId: NodeId): boolean {
    return this.#camerasCell.peek().has(pageId);
  }

  /**
   * Shows a page, restoring the camera it had when last shown.
   *
   * @remarks
   * Leaves whatever was edited, selected, or hovered on the previous page and
   * resets the active tool. None of this is an undo step.
   */
  activate(pageId: NodeId): void {
    const scene = this.#editor.scene;
    const current = scene.shownPageIdCell.peek();
    if (current === pageId || !scene.nodeOfKind(pageId, "page")) return;

    if (current) this.#rememberCamera(current, this.#camera());
    this.#editor.history.withoutRecording(() => this.#editor.exitNodes());
    scene.showPage(pageId);
    this.#editor.toolManager.reset();

    const camera = this.#camerasCell.peek().get(pageId);
    if (camera) this.#apply(camera);
  }

  #rememberCamera(pageId: NodeId, camera: PageCamera): void {
    this.#camerasCell.set(new Map(this.#camerasCell.peek()).set(pageId, camera));
  }

  #forgetCamera(pageId: NodeId): void {
    const cameras = new Map(this.#camerasCell.peek());
    if (cameras.delete(pageId)) this.#camerasCell.set(cameras);
  }

  #apply(camera: PageCamera): void {
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
