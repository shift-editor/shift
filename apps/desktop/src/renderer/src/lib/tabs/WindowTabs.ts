import type { Editor } from "@shift/editor";
import { effect, signal, type Signal, type WritableSignal } from "@shift/editor/signals";
import type { GlyphNode, PageNode } from "@shift/editor/types";
import type { GlyphId, NodeId } from "@shift/types";
import { CANVAS_PATH, glyphIdFromPath } from "@/lib/editorRoute";

/** The pinned font overview tab's id. */
export const GLYPHS_TAB_ID = "glyphs";

/**
 * One tab of a window.
 *
 * @remarks
 * `glyphs` is the font overview, always first. A `page` tab shows one of the
 * user's pages. A `glyph` tab shows a glyph opened from the overview on a
 * glyph-view page of its own, which closing the tab discards.
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

/** What a window shows, read from its route: the overview, a glyph tab's glyph, or a page. */
export type WindowLocation =
  | { readonly kind: "glyphs" }
  | { readonly kind: "glyph"; readonly glyphId: GlyphId }
  | { readonly kind: "canvas"; readonly pageId: NodeId | null };

/** A window's tabs as view memory keeps them: the page and glyph tabs in order, and the overview's page. */
export interface WindowTabsView {
  readonly tabs: readonly StoredWindowTab[];
  readonly selectionPageId: NodeId | null;
}

/** A page or glyph tab without its session-only id. */
export type StoredWindowTab =
  | { readonly kind: "page"; readonly pageId: NodeId }
  | { readonly kind: "glyph"; readonly pageId: NodeId; readonly glyphId: GlyphId };

/** The result of opening a glyph in a tab. */
export interface OpenedGlyph {
  /** The edited glyph node, or null when the glyph could not be shown. */
  readonly node: GlyphNode | null;
  /** True when the glyph was newly placed, so the view should fit it; false for a tab already open. */
  readonly placed: boolean;
}

const GLYPHS_TAB: WindowTab = { kind: "glyphs", id: GLYPHS_TAB_ID };

/**
 * A window's open tabs: the font overview, then pages and glyphs in the order opened.
 *
 * @remarks
 * Which tab is active is not stored: it follows the route and the shown page
 * ({@link WindowTabs.activeTab}), so navigation from anywhere keeps it right.
 * Session state, never saved or undone. A page deleted from the pages list
 * closes its tab.
 */
export class WindowTabs {
  readonly #editor: Editor;
  readonly #tabs: WritableSignal<readonly WindowTab[]>;
  readonly #selectedGlyph: WritableSignal<GlyphId | null>;
  #selectionPageId: NodeId | null = null;
  #nextId = 1;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#tabs = signal<readonly WindowTab[]>([GLYPHS_TAB], { name: "desktop.windowTabs" });
    this.#selectedGlyph = signal<GlyphId | null>(null, { name: "desktop.overviewSelection" });

    // Lives as long as the editor: a page deleted anywhere closes its tab.
    effect(() => {
      const pageIds = new Set(editor.scene.pagesCell.value.map((page) => page.id));
      const tabs = this.#tabs.peek();
      const kept = tabs.filter((tab) => tab.kind === "glyphs" || pageIds.has(tab.pageId));
      if (kept.length !== tabs.length) this.#tabs.set(kept);
    });
  }

  get tabsCell(): Signal<readonly WindowTab[]> {
    return this.#tabs;
  }

  /** Returns the tab showing `location`, or null when no open tab shows it. */
  activeTab(location: WindowLocation): WindowTab | null {
    const tabs = this.#tabs.peek();
    switch (location.kind) {
      case "glyphs":
        return GLYPHS_TAB;
      case "glyph":
        return tabs.find((tab) => tab.kind === "glyph" && tab.glyphId === location.glyphId) ?? null;
      case "canvas":
        return tabs.find((tab) => tab.kind === "page" && tab.pageId === location.pageId) ?? null;
    }
  }

  /** Returns the page's tab, opening one after the last tab when it has none. */
  openPage(pageId: NodeId): WindowTab {
    const existing = this.#tabs.peek().find((tab) => tab.kind === "page" && tab.pageId === pageId);
    if (existing) return existing;

    const tab: WindowTab = { kind: "page", id: this.#mintId(), pageId };
    this.#tabs.update((tabs) => [...tabs, tab]);
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
    const existing = this.#tabs.peek().find((tab) => tab.kind === "page" && tab.pageId === pageId);
    if (existing) return existing;
    if (newTab || shown?.kind !== "page") return this.openPage(pageId);

    const next: WindowTab = { ...shown, pageId };
    this.#replace(shown.id, next);
    return next;
  }

  /**
   * Shows a glyph opened from the overview in a tab of its own and edits it.
   *
   * @remarks
   * A glyph already open in a tab is shown there as it was left. Navigation,
   * never a history entry.
   */
  openGlyph(glyphId: GlyphId): OpenedGlyph {
    return this.#editor.history.withoutRecording(() => this.#openGlyph(glyphId));
  }

  #openGlyph(glyphId: GlyphId): OpenedGlyph {
    const pages = this.#editor.pages;
    const open = this.#tabs.peek().find((tab) => tab.kind === "glyph" && tab.glyphId === glyphId);
    if (open?.kind === "glyph") {
      pages.activate(open.pageId);
      const node =
        this.#editor.scene
          .nodesOfKind("glyph")
          .find((candidate) => candidate.glyphId === glyphId) ?? null;
      if (node) this.#editor.enterNode(node.id);
      return { node, placed: false };
    }

    const page = pages.createGlyphPage();
    const node = this.#editor.openGlyphInText(glyphId, page);
    const tab: WindowTab = { kind: "glyph", id: this.#mintId(), pageId: page.id, glyphId };
    this.#tabs.update((current) => [...current, tab]);
    return { node, placed: true };
  }

  /**
   * The glyph selected in the font overview, or null.
   *
   * @remarks
   * Selection is not a tab: the glyph goes on a glyph-view page of the
   * overview's own, shown while the overview is, so the glyph sidebar describes
   * and edits it.
   */
  get selectedGlyphCell(): Signal<GlyphId | null> {
    return this.#selectedGlyph;
  }

  /**
   * Selects a loaded glyph in the font overview and shows it on the overview's page.
   *
   * @remarks
   * Navigation, never a history entry.
   */
  selectGlyph(glyphId: GlyphId): void {
    this.#selectedGlyph.set(glyphId);
    const page = this.#editor.history.withoutRecording(() => this.#selectionPage());
    this.#editor.openGlyphInText(glyphId, page);
  }

  /**
   * Shows the overview's page again, with its selected glyph, after another
   * page was shown. Does nothing while no glyph is selected.
   */
  showSelection(): void {
    const pageId = this.#selectionPageId;
    if (this.#selectedGlyph.peek() !== null && pageId) this.#editor.pages.activate(pageId);
  }

  /**
   * Closes a tab and returns the tab to show if it was the one shown: its right
   * neighbour, else its left one. The overview tab never closes.
   *
   * @remarks
   * A glyph tab's page goes with it; a page tab only closes, and the page stays.
   */
  close(tabId: string): WindowTab {
    const tabs = this.#tabs.peek();
    const at = tabs.findIndex((tab) => tab.id === tabId);
    const tab = tabs[at];
    if (!tab || tab.kind === "glyphs") return GLYPHS_TAB;

    const neighbour = tabs[at + 1] ?? tabs[at - 1] ?? GLYPHS_TAB;
    this.#tabs.set(tabs.filter((candidate) => candidate.id !== tabId));
    if (tab.kind === "glyph") this.#editor.pages.discardGlyphPage(tab.pageId);
    return neighbour;
  }

  /** The tabs as view memory keeps them; the pinned overview is implied. */
  view(): WindowTabsView {
    const tabs: StoredWindowTab[] = [];
    for (const tab of this.#tabs.peek()) {
      switch (tab.kind) {
        case "glyphs":
          continue;
        case "page":
          tabs.push({ kind: "page", pageId: tab.pageId });
          continue;
        case "glyph":
          tabs.push({ kind: "glyph", pageId: tab.pageId, glyphId: tab.glyphId });
          continue;
      }
    }

    return { tabs, selectionPageId: this.#selectionPageId };
  }

  /**
   * Reopens the tabs a window had, after the overview.
   *
   * @remarks
   * A tab whose page is gone, or whose glyph is no longer in the font, is
   * dropped and logged. Replaces any tabs opened since the window started.
   *
   * @returns the tabs dropped.
   */
  restore(view: WindowTabsView): readonly StoredWindowTab[] {
    const scene = this.#editor.scene;
    const font = this.#editor.font;
    const kept: WindowTab[] = [GLYPHS_TAB];
    const dropped: StoredWindowTab[] = [];
    for (const stored of view.tabs) {
      const pageExists = scene.nodeOfKind(stored.pageId, "page") !== null;
      const glyphExists = stored.kind === "page" || font.recordForId(stored.glyphId) !== null;
      if (!pageExists || !glyphExists) {
        dropped.push(stored);
        continue;
      }

      kept.push({ ...stored, id: this.#mintId() });
    }
    if (dropped.length > 0) console.info("dropped window tabs that no longer resolve", dropped);

    this.#tabs.set(kept);
    const selectionPage = view.selectionPageId
      ? scene.nodeOfKind(view.selectionPageId, "page")
      : null;
    if (selectionPage) this.#selectionPageId = selectionPage.id;
    return dropped;
  }

  #selectionPage(): PageNode {
    const existing = this.#selectionPageId
      ? this.#editor.scene.nodeOfKind(this.#selectionPageId, "page")
      : null;
    if (existing) return existing;

    const page = this.#editor.pages.createGlyphPage();
    this.#selectionPageId = page.id;
    return page;
  }

  #replace(tabId: string, next: WindowTab): void {
    this.#tabs.update((tabs) => tabs.map((tab) => (tab.id === tabId ? next : tab)));
  }

  #mintId(): string {
    return `tab-${this.#nextId++}`;
  }
}

/** Reads what a window shows from its route and the page its canvas shows. */
export function windowLocation(pathname: string, activePageId: NodeId | null): WindowLocation {
  const glyphId = glyphIdFromPath(pathname);
  if (glyphId) return { kind: "glyph", glyphId };
  if (pathname === CANVAS_PATH) return { kind: "canvas", pageId: activePageId };
  return { kind: "glyphs" };
}

const windowTabsByEditor = new WeakMap<Editor, WindowTabs>();

/** Returns the editor's window tabs, creating them the first time. */
export function windowTabs(editor: Editor): WindowTabs {
  let tabs = windowTabsByEditor.get(editor);
  if (!tabs) windowTabsByEditor.set(editor, (tabs = new WindowTabs(editor)));
  return tabs;
}
