import { useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import type { NodeId } from "@shift/types";
import { WindowNavigation } from "@/lib/tabs/WindowNavigation";
import type { WindowTab, WindowTabs } from "@/lib/tabs/WindowTabs";
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
  const { pathname } = useLocation();
  // Read at the time of a click, not when the navigation was built.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  return useMemo(() => {
    const navigation = new WindowNavigation(editor, tabs, {
      pathname: () => pathnameRef.current,
      navigate: (path) => navigate(path),
    });
    return {
      tabs,
      show: (tab) => navigation.show(tab),
      showPage: (pageId, options) => navigation.showPage(pageId, options),
      close: (tab, shown) => navigation.close(tab, shown),
      closeShown: () => navigation.closeShown(),
    };
  }, [editor, navigate, tabs]);
};
