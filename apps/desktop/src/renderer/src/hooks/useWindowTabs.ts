import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { NodeId } from "@shift/types";
import { CANVAS_PATH, editorPath } from "@/lib/editorRoute";
import { windowLocation, type WindowTab, type WindowTabs } from "@/lib/tabs/WindowTabs";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

/** The window's tabs, and the navigation that shows them. */
export interface WindowTabNavigation {
  readonly tabs: WindowTabs;
  /** Shows a tab: the overview, a page's canvas, or a glyph tab's glyph. */
  readonly show: (tab: WindowTab) => void;
  /**
   * Shows a page as a browser follows a link: in the shown page tab, or in a
   * tab of its own from the overview or a glyph tab, or with `newTab`.
   */
  readonly showPage: (pageId: NodeId, options?: { readonly newTab?: boolean }) => void;
  /** Closes a tab; when it was the one shown, shows its neighbour. */
  readonly close: (tab: WindowTab, shown: boolean) => void;
  /**
   * Closes the shown tab, as Close Tab does, and shows its neighbour.
   *
   * @returns false when only the pinned overview is shown, so the window should close instead.
   */
  readonly closeShown: () => boolean;
}

export const useWindowTabs = (): WindowTabNavigation => {
  const editor = useEditor();
  const { tabs } = useFontSession();
  const navigate = useNavigate();

  const show = useCallback(
    (tab: WindowTab) => {
      switch (tab.kind) {
        case "glyphs":
          // The overview shows its selected glyph again, so the glyph sidebar describes it.
          tabs.showSelection();
          navigate("/home");
          return;
        case "page":
          editor.pages.activate(tab.pageId);
          navigate(CANVAS_PATH);
          return;
        case "glyph":
          navigate(editorPath(tab.glyphId));
          return;
      }
    },
    [editor, navigate, tabs],
  );

  const { pathname } = useLocation();
  const location = useCallback(
    () => windowLocation(pathname, editor.scene.shownPageIdCell.peek()),
    [editor, pathname],
  );

  const showPage = useCallback(
    (pageId: NodeId, options?: { readonly newTab?: boolean }) => {
      const shown = tabs.activeTab(location());
      show(tabs.navigateToPage(pageId, shown, options?.newTab ?? false));
    },
    [location, show, tabs],
  );

  const close = useCallback(
    (tab: WindowTab, shown: boolean) => {
      const next = tabs.close(tab.id);
      if (shown) show(next);
    },
    [show, tabs],
  );

  const closeShown = useCallback(() => {
    const outcome = tabs.closeShown(location());
    if (outcome.kind === "closeWindow") return false;

    show(outcome.tab);
    return true;
  }, [location, show, tabs]);

  return useMemo(
    () => ({ tabs, show, showPage, close, closeShown }),
    [close, closeShown, show, showPage, tabs],
  );
};

/**
 * Lets undo and redo show the tab of the page they change, through the
 * window's navigation; a tab already shown is left alone. Mount once per
 * window.
 */
export const useShowReplayedPages = (): void => {
  const editor = useEditor();
  const { tabs, show } = useWindowTabs();
  const { pathname } = useLocation();

  useEffect(
    () =>
      tabs.followReveals((tab) => {
        const shown = tabs.activeTab(windowLocation(pathname, editor.scene.shownPageIdCell.peek()));
        if (shown?.id !== tab.id) show(tab);
      }),
    [editor, pathname, show, tabs],
  );
};
