import type { Editor } from "@shift/editor";
import type { NodeId } from "@shift/types";
import { CANVAS_PATH, editorPath } from "@/lib/editorRoute";
import { windowLocation, type WindowTab, type WindowTabs } from "./WindowTabs";

/**
 * A window's route: where it is, and how to move it.
 *
 * @remarks
 * Components pass React Router's location and `navigate`; code outside React
 * passes the URL hash the window's router follows.
 */
export interface WindowRouter {
  /** The route's path now, such as `/canvas` or `/editor/glyph-1`. */
  pathname(): string;
  navigate(path: string): void;
}

/**
 * Shows a window's tabs: the overview, a page's canvas, or a glyph tab's glyph.
 *
 * @remarks
 * The one place tab navigation is decided, for the tab bar, the pages list,
 * Close Tab and agents alike. Navigation is session state, never a history
 * entry.
 */
export class WindowNavigation {
  readonly #editor: Editor;
  readonly #tabs: WindowTabs;
  readonly #router: WindowRouter;

  constructor(editor: Editor, tabs: WindowTabs, router: WindowRouter) {
    this.#editor = editor;
    this.#tabs = tabs;
    this.#router = router;
  }

  /** Shows a tab: the overview, a page's canvas, or a glyph tab's glyph. */
  show(tab: WindowTab): void {
    switch (tab.kind) {
      case "glyphs":
        // The overview shows its selected glyph again, so the glyph sidebar describes it.
        this.#tabs.showSelection();
        this.#router.navigate("/home");
        return;
      case "page":
        this.#editor.pages.activate(tab.pageId);
        this.#router.navigate(CANVAS_PATH);
        return;
      case "glyph":
        this.#router.navigate(editorPath(tab.glyphId));
        return;
    }
  }

  /**
   * Shows a page as a browser follows a link: in the shown page tab, or in a
   * tab of its own from the overview or a glyph tab, or with `newTab`.
   */
  showPage(pageId: NodeId, options?: { readonly newTab?: boolean }): void {
    const shown = this.#tabs.activeTab(this.#location());
    this.show(this.#tabs.navigateToPage(pageId, shown, options?.newTab ?? false));
  }

  /** Closes a tab; when it was the one shown, shows its neighbour. */
  close(tab: WindowTab, shown: boolean): void {
    const next = this.#tabs.close(tab.id);
    if (shown) this.show(next);
  }

  /**
   * Closes the shown tab, as Close Tab does, and shows its neighbour.
   *
   * @returns false when only the pinned overview is shown, so the window should close instead.
   */
  closeShown(): boolean {
    const outcome = this.#tabs.closeShown(this.#location());
    if (outcome.kind === "closeWindow") return false;

    this.show(outcome.tab);
    return true;
  }

  #location() {
    return windowLocation(this.#router.pathname(), this.#editor.scene.shownPageIdCell.peek());
  }
}
