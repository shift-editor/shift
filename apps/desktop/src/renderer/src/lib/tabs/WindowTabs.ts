import type { Editor } from "@shift/editor";
import { computed, signal, type Signal, type WritableSignal } from "@shift/editor/signals";
import type { GlyphNode, PageNode } from "@shift/editor/types";
import type { GlyphId, NodeId } from "@shift/types";
import { CANVAS_PATH, glyphIdFromPath } from "@/lib/editorRoute";
import type { StoredTab } from "@/lib/workspace/documentViews";

/** The pinned font overview tab's id. */
export const GLYPHS_TAB_ID = "glyphs";

/**
 * One tab of a window.
 *
 * @remarks
 * `glyphs` is the font overview, always first. A `page` tab shows one of the
 * user's pages. A `glyph` tab shows a glyph opened from the overview on a
 * glyph page of its own, which closing the tab discards.
 */
export type WindowTab =
  | { readonly kind: "glyphs"; readonly id: typeof GLYPHS_TAB_ID }
  | { readonly kind: "page"; readonly id: string; readonly pageId: NodeId }
  | {
      readonly kind: "glyph";
      readonly id: string;
      readonly pageId: NodeId;
      readonly glyphId: GlyphId;
    };

/** A page or glyph tab: every tab but the pinned overview. */
export type MovableTab = Exclude<WindowTab, { readonly kind: "glyphs" }>;

/** What a window shows, read from its route: the overview, a glyph tab's glyph, or a page. */
export type WindowLocation =
  | { readonly kind: "glyphs" }
  | { readonly kind: "glyph"; readonly glyphId: GlyphId }
  | { readonly kind: "canvas"; readonly pageId: NodeId | null };

/** A window's tabs as view memory keeps them: the page and glyph tabs in order, and the overview's page. */
export interface WindowTabsView {
  readonly tabs: readonly StoredTab[];
  readonly selectionPageId: NodeId | null;
}

/** The result of opening a glyph in a tab. */
export interface OpenedGlyph {
  /** The edited glyph node, or null when the glyph could not be shown. */
  readonly node: GlyphNode | null;
  /** True when the glyph was newly placed, so the view should fit it; false for a tab already open. */
  readonly placed: boolean;
}

/** What closing the shown tab leads to: another tab to show, or closing the window. */
export type TabClose =
  | { readonly kind: "show"; readonly tab: WindowTab }
  | { readonly kind: "closeWindow" };

const GLYPHS_TAB: WindowTab = { kind: "glyphs", id: GLYPHS_TAB_ID };

/**
 * A window's open tabs: the font overview, then pages and glyphs in the order
 * the user arranged them.
 *
 * @remarks
 * Owned by the window's font session and disposed with it. Which tab is
 * active is not stored: it follows the route and the shown page
 * ({@link WindowTabs.activeTab}), so navigation from anywhere keeps it right.
 * Session state, never saved in the document or undone.
 *
 * Tabs follow the pages without an effect: {@link tabsCell} is derived from
 * the tabs the user opened and the scene's pages. A page tab whose page is
 * deleted moves to the page the canvas falls back to when that page has no
 * tab, as a browser tab follows a redirect, and otherwise closes.
 */
export class WindowTabs {
  readonly #editor: Editor;
  /** The tabs as opened and arranged, before pages deleted since are accounted for. */
  readonly #openedCell: WritableSignal<readonly MovableTab[]>;
  readonly #tabsCell: Signal<readonly WindowTab[]>;
  readonly #selectedGlyphCell: WritableSignal<GlyphId | null>;
  readonly #selectionPageIdCell: WritableSignal<NodeId | null>;
  #nextId = 1;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#openedCell = signal<readonly MovableTab[]>([], { name: "desktop.windowTabs.opened" });
    this.#selectedGlyphCell = signal<GlyphId | null>(null, { name: "desktop.overviewSelection" });
    this.#selectionPageIdCell = signal<NodeId | null>(null, {
      name: "desktop.overviewSelectionPage",
    });
    this.#tabsCell = computed(
      () =>
        resolveTabs(
          this.#openedCell.value,
          editor.scene.pagesCell.value,
          editor.scene.shownPageIdCell.value,
        ),
      { name: "desktop.windowTabs" },
    );
  }

  /** The window's tabs: the pinned overview first, then the page and glyph tabs in order. */
  get tabsCell(): Signal<readonly WindowTab[]> {
    return this.#tabsCell;
  }

  /**
   * The glyph selected in the font overview, or null.
   *
   * @remarks
   * The one record of the overview's selection. Selection is not a tab: the
   * glyph goes on a glyph page of the overview's own, shown while the overview
   * is, so the glyph sidebar describes and edits it.
   */
  get selectedGlyphCell(): Signal<GlyphId | null> {
    return this.#selectedGlyphCell;
  }

  /** The page the overview shows its selected glyph on, or null before a glyph is selected. */
  get selectionPageIdCell(): Signal<NodeId | null> {
    return this.#selectionPageIdCell;
  }

  /** Returns the tab showing `location`, or null when no open tab shows it. */
  activeTab(location: WindowLocation): WindowTab | null {
    switch (location.kind) {
      case "glyphs":
        return GLYPHS_TAB;
      case "glyph":
        return this.glyphTab(location.glyphId);
      case "canvas":
        return location.pageId ? this.pageTab(location.pageId) : null;
    }
  }

  /** Returns the tab showing page `pageId`, or null when it has none. */
  pageTab(pageId: NodeId): MovableTab | null {
    return this.#movable().find((tab) => tab.kind === "page" && tab.pageId === pageId) ?? null;
  }

  /** Returns the tab showing glyph `glyphId`, or null when it has none. */
  glyphTab(glyphId: GlyphId): MovableTab | null {
    return this.#movable().find((tab) => tab.kind === "glyph" && tab.glyphId === glyphId) ?? null;
  }

  /** Returns the page's tab, opening one after the last tab when it has none. */
  openPage(pageId: NodeId): WindowTab {
    const existing = this.pageTab(pageId);
    if (existing) return existing;

    const tab: MovableTab = { kind: "page", id: this.#mintId(), pageId };
    this.#openedCell.set([...this.#movable(), tab]);
    return tab;
  }

  /**
   * Returns the tab to show a page in, as a browser follows a link: a page tab
   * that is shown switches to the page; from the overview or a glyph tab, or
   * with `newTab`, the page gets a tab of its own.
   *
   * @remarks
   * A page already open in a tab is shown there, so no page has two tabs.
   *
   * @param shown - the tab shown now, or null when none is.
   */
  navigateToPage(pageId: NodeId, shown: WindowTab | null, newTab = false): WindowTab {
    const existing = this.pageTab(pageId);
    if (existing) return existing;
    if (newTab || shown?.kind !== "page") return this.openPage(pageId);

    const next: MovableTab = { ...shown, pageId };
    this.#openedCell.set(this.#movable().map((tab) => (tab.id === shown.id ? next : tab)));
    return next;
  }

  /**
   * Shows a glyph opened from the overview in a tab of its own and edits it.
   *
   * @remarks
   * A glyph already open in a tab is shown there as it was left; otherwise the
   * glyph goes on a new glyph page. Navigation, never a history entry.
   */
  openGlyph(glyphId: GlyphId): OpenedGlyph {
    return this.#editor.history.withoutRecording(() => this.#openGlyph(glyphId));
  }

  /**
   * Selects a glyph in the font overview.
   *
   * @remarks
   * Records the selection at once, so the overview highlights it. Call
   * {@link showSelection} once the glyph is loaded to show it on the
   * overview's page.
   */
  selectGlyph(glyphId: GlyphId): void {
    this.#selectedGlyphCell.set(glyphId);
  }

  /**
   * Shows the overview's selected glyph on the overview's page.
   *
   * @remarks
   * Does nothing while no glyph is selected. The glyph must be loaded.
   * Navigation, never a history entry.
   */
  showSelection(): void {
    const glyphId = this.#selectedGlyphCell.peek();
    if (glyphId === null) return;

    const shown = this.#editor.history.withoutRecording(() => {
      const page = this.#selectionPage();
      const run = this.#editor.scene.children(page.id).find((node) => node.kind === "textRun");
      const child =
        run?.kind === "textRun" ? this.#editor.nodeDefinition("textRun").childGlyph(run) : null;
      // The page already shows the selected glyph: show it as it was left.
      if (child?.glyphId === glyphId) {
        this.#editor.pages.activate(page.id);
        return true;
      }
      return this.#editor.openGlyphInText(glyphId, page) !== null;
    });
    if (!shown) console.warn("could not show the overview's selected glyph", glyphId);
  }

  /**
   * Moves a page or glyph tab to `index` among the page and glyph tabs.
   *
   * @remarks
   * The overview stays pinned first and cannot move.
   *
   * @param index - position among the page and glyph tabs after the move; clamped.
   */
  move(tabId: string, index: number): void {
    const tabs = this.#movable();
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    const others = tabs.filter((candidate) => candidate.id !== tabId);
    const to = Math.max(0, Math.min(Math.trunc(index), others.length));
    this.#openedCell.set([...others.slice(0, to), tab, ...others.slice(to)]);
  }

  /**
   * Closes a tab and returns the tab to show if it was the one shown: its right
   * neighbour, else its left one. The overview tab never closes.
   *
   * @remarks
   * A glyph tab's page goes with it; a page tab only closes, and the page stays.
   */
  close(tabId: string): WindowTab {
    const tabs = this.#tabsCell.peek();
    const at = tabs.findIndex((tab) => tab.id === tabId);
    const tab = tabs[at];
    if (!tab || tab.kind === "glyphs") return GLYPHS_TAB;

    const neighbour = tabs[at + 1] ?? tabs[at - 1] ?? GLYPHS_TAB;
    this.#openedCell.set(this.#movable().filter((candidate) => candidate.id !== tabId));
    if (tab.kind === "glyph") this.#editor.pages.discardGlyphPage(tab.pageId);
    return neighbour;
  }

  /**
   * Closes the tab showing `location`, as Close Tab does.
   *
   * @returns the tab to show next, or `closeWindow` when only the pinned
   * overview is shown or nothing closable is: Close Tab then closes the window.
   */
  closeShown(location: WindowLocation): TabClose {
    const shown = this.activeTab(location);
    if (!shown || shown.kind === "glyphs") return { kind: "closeWindow" };

    return { kind: "show", tab: this.close(shown.id) };
  }

  /** The tabs as view memory keeps them, in order; the pinned overview is implied. */
  view(): WindowTabsView {
    const tabs = this.#movable().map((tab): StoredTab => {
      switch (tab.kind) {
        case "page":
          return { kind: "page", pageId: tab.pageId };
        case "glyph":
          return { kind: "glyph", pageId: tab.pageId, glyphId: tab.glyphId };
      }
    });
    return { tabs, selectionPageId: this.#selectionPageIdCell.peek() };
  }

  /**
   * Reopens the tabs a window had, after the overview, in their order.
   *
   * @remarks
   * A tab whose page is gone, or whose glyph is no longer in the font, is
   * dropped and logged. Replaces any tabs opened since the window started.
   *
   * @returns the tabs dropped.
   */
  restore(view: WindowTabsView): readonly StoredTab[] {
    const scene = this.#editor.scene;
    const font = this.#editor.font;
    const kept: MovableTab[] = [];
    const dropped: StoredTab[] = [];
    for (const stored of view.tabs) {
      const pageExists = scene.nodeOfKind(stored.pageId, "page") !== null;
      const glyphExists = stored.kind === "page" || font.recordForId(stored.glyphId) !== null;
      if (pageExists && glyphExists) kept.push({ ...stored, id: this.#mintId() });
      else dropped.push(stored);
    }
    if (dropped.length > 0) console.info("dropped window tabs that no longer resolve", dropped);

    this.#openedCell.set(kept);
    const selectionPage = scene.nodeOfKind(view.selectionPageId, "page");
    if (selectionPage) this.#selectionPageIdCell.set(selectionPage.id);
    return dropped;
  }

  #openGlyph(glyphId: GlyphId): OpenedGlyph {
    const open = this.glyphTab(glyphId);
    if (open) {
      this.#editor.pages.activate(open.pageId);
      const node = this.#editor.scene.first("glyph");
      if (node) this.#editor.enterNode(node.id);
      return { node, placed: false };
    }

    const page = this.#editor.pages.createGlyphPage();
    const node = this.#editor.openGlyphInText(glyphId, page);
    const tab: MovableTab = { kind: "glyph", id: this.#mintId(), pageId: page.id, glyphId };
    this.#openedCell.set([...this.#movable(), tab]);
    return { node, placed: true };
  }

  /** The page and glyph tabs, as {@link tabsCell} resolves them now. */
  #movable(): readonly MovableTab[] {
    return this.#tabsCell.peek().filter(isMovableTab);
  }

  #selectionPage(): PageNode {
    const existing = this.#editor.scene.nodeOfKind(this.#selectionPageIdCell.peek(), "page");
    if (existing) return existing;

    const page = this.#editor.pages.createGlyphPage();
    this.#selectionPageIdCell.set(page.id);
    return page;
  }

  #mintId(): string {
    return `tab-${this.#nextId++}`;
  }
}

/**
 * The tabs a window shows: the pinned overview, then each opened tab whose
 * page still exists. A deleted page's tab follows to the shown page, once,
 * when that is one of the user's pages and has no tab of its own.
 */
function resolveTabs(
  opened: readonly MovableTab[],
  pages: readonly PageNode[],
  shownPageId: NodeId | null,
): readonly WindowTab[] {
  const pageIds = new Set(pages.map((page) => page.id));
  const shownPage = pages.find((page) => page.id === shownPageId) ?? null;
  const shownIsUntabbedUserPage =
    shownPage !== null && shownPage.role === undefined && !hasPageTab(opened, shownPage.id);
  let fallback = shownIsUntabbedUserPage ? shownPage.id : null;

  const tabs: WindowTab[] = [GLYPHS_TAB];
  for (const tab of opened) {
    if (pageIds.has(tab.pageId)) {
      tabs.push(tab);
      continue;
    }
    if (tab.kind === "page" && fallback) {
      tabs.push({ ...tab, pageId: fallback });
      fallback = null;
    }
  }
  return tabs;
}

/** Whether a tab is a page or glyph tab, which can move and close, rather than the pinned overview. */
export function isMovableTab(tab: WindowTab): tab is MovableTab {
  return tab.kind !== "glyphs";
}

function hasPageTab(tabs: readonly MovableTab[], pageId: NodeId): boolean {
  return tabs.some((tab) => tab.kind === "page" && tab.pageId === pageId);
}

/** Reads what a window shows from its route and the page its canvas shows. */
export function windowLocation(pathname: string, shownPageId: NodeId | null): WindowLocation {
  const glyphId = glyphIdFromPath(pathname);
  if (glyphId) return { kind: "glyph", glyphId };
  if (pathname === CANVAS_PATH) return { kind: "canvas", pageId: shownPageId };
  return { kind: "glyphs" };
}
