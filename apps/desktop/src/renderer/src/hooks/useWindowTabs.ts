import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { NodeId } from "@shift/types";
import { CANVAS_PATH, editorPath } from "@/lib/editorRoute";
import { windowLocation, windowTabs, type WindowTab, type WindowTabs } from "@/lib/tabs/WindowTabs";
import { useEditor } from "@/workspace/WorkspaceContext";

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
}

export const useWindowTabs = (): WindowTabNavigation => {
  const editor = useEditor();
  const navigate = useNavigate();
  const tabs = windowTabs(editor);

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
  const showPage = useCallback(
    (pageId: NodeId, options?: { readonly newTab?: boolean }) => {
      const shown = tabs.activeTab(windowLocation(pathname, editor.pages.activeCell.peek()));
      show(tabs.navigateToPage(pageId, shown, options?.newTab ?? false));
    },
    [editor, pathname, show, tabs],
  );

  const close = useCallback(
    (tab: WindowTab, shown: boolean) => {
      const next = tabs.close(tab.id);
      if (shown) show(next);
    },
    [show, tabs],
  );

  return useMemo(() => ({ tabs, show, showPage, close }), [close, show, showPage, tabs]);
};
