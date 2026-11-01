import { asNodeId, type NodeId } from "@shift/types";
import type { Editor } from "@shift/editor";
import type { PageCamera } from "@shift/editor/types";
import { effect, track, type Signal } from "@shift/editor/signals";
import { DocumentViews } from "@/lib/workspace/documentViews";
import type { WindowTabs } from "./WindowTabs";

const DEFAULT_DELAY_MS = 500;

/** How a {@link WindowViewMemory} finds and keeps its document's view. */
export interface WindowViewMemoryOptions {
  /** The open document's view key (`documentViewKey`), or null while none is open. */
  readonly keyCell: Signal<string | null>;
  /** Where views are kept; the window's `localStorage` by default. */
  readonly views?: DocumentViews;
  /** Quiet time before a change is written. */
  readonly delayMs?: number;
}

/**
 * Remembers a window's tabs, shown page and each page's camera with its
 * other view state, and reopens them with the document.
 *
 * @remarks
 * View state is personal, so it goes into {@link DocumentViews}, never the
 * document: switching tabs or pages never marks the document unsaved. Writes
 * wait for `delayMs` of quiet; {@link flush} writes at once, and the window
 * flushes before a save, on close and on blur. Nothing is written until
 * {@link restore} runs, so a window that is still opening cannot overwrite the
 * tabs it is about to reopen.
 */
export class WindowViewMemory {
  readonly #editor: Editor;
  readonly #tabs: WindowTabs;
  readonly #keyCell: Signal<string | null>;
  readonly #views: DocumentViews;
  readonly #delayMs: number;
  readonly #stop: () => void;
  #restored = false;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(editor: Editor, tabs: WindowTabs, options: WindowViewMemoryOptions) {
    this.#editor = editor;
    this.#tabs = tabs;
    this.#keyCell = options.keyCell;
    this.#views = options.views ?? new DocumentViews();
    this.#delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

    const reader = effect(() => {
      track(tabs.tabsCell);
      track(tabs.selectionPageIdCell);
      track(editor.scene.shownPageIdCell);
      track(editor.panCell);
      track(editor.zoomCell);
      track(this.#keyCell);
      this.#schedule();
    });
    this.#stop = () => reader.dispose();
  }

  /**
   * Reopens the tabs, the shown page and the page cameras remembered for the
   * open document.
   *
   * @remarks
   * Call once the document's canvas is restored, so the pages the tabs show
   * exist. Tabs whose page or glyph is gone are dropped and logged, and a
   * camera whose page is gone is dropped. The cameras go back first, so the
   * shown page opens with its own.
   */
  restore(): void {
    this.#restored = true;
    const key = this.#keyCell.peek();
    const view = key === null ? null : this.#views.read(key);
    if (!view) return;

    this.#editor.pages.restoreCameras(storedCameras(view.cameras));
    this.#tabs.restore({
      tabs: view.tabs ?? [],
      selectionPageId: view.selectionPageId ?? null,
    });
    const page = view.pageId ? this.#editor.scene.nodeOfKind(view.pageId, "page") : null;
    if (page) this.#editor.pages.activate(page.id);
  }

  /** Writes a pending change now. */
  flush(): void {
    this.#cancelTimer();
    if (!this.#restored) return;

    const key = this.#keyCell.peek();
    if (key === null) return;

    const { tabs, selectionPageId } = this.#tabs.view();
    const pageId = this.#editor.scene.shownPageIdCell.peek();
    this.#views.update(key, {
      tabs: [...tabs],
      selectionPageId: selectionPageId ?? undefined,
      pageId: pageId ?? undefined,
      cameras: Object.fromEntries(this.#editor.pages.cameras()),
    });
  }

  /** Writes a pending change and stops following the window. */
  dispose(): void {
    this.flush();
    this.#stop();
  }

  #schedule(): void {
    this.#cancelTimer();
    this.#timer = setTimeout(() => this.flush(), this.#delayMs);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;

    clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** The cameras a view kept, by page id; none when it kept no cameras. */
function storedCameras(
  cameras: Readonly<Record<NodeId, PageCamera>> | undefined,
): ReadonlyMap<NodeId, PageCamera> {
  return new Map(
    Object.entries(cameras ?? {}).map(([pageId, camera]) => [asNodeId(pageId), camera]),
  );
}
