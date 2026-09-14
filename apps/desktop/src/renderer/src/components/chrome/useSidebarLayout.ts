import { useEffect, useRef, type RefObject } from "react";

import type { ResizablePanelHandle } from "@shift/ui";

const SIDEBAR_LAYOUT_ANIMATION_DURATION_MS = 150;

export const useSidebarLayout = () => {
  const leftSidebarPanelRef = useRef<ResizablePanelHandle>(null);
  const rightSidebarPanelRef = useRef<ResizablePanelHandle>(null);
  const leftSidebarContentRef = useRef<HTMLDivElement>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarLayoutAnimationTimeoutRef = useRef<number | null>(null);

  const finishSidebarLayoutAnimation = (groupElement: HTMLElement) => {
    groupElement.classList.remove("sidebar-layout-animating");

    if (leftSidebarPanelRef.current?.isExpanded() && leftSidebarContentRef.current) {
      leftSidebarContentRef.current.style.width = "";
    }
    if (rightSidebarPanelRef.current?.isExpanded() && rightSidebarContentRef.current) {
      rightSidebarContentRef.current.style.width = "";
    }

    sidebarLayoutAnimationTimeoutRef.current = null;
  };

  const toggleSidebar = (
    panelRef: RefObject<ResizablePanelHandle | null>,
    contentRef: RefObject<HTMLDivElement | null>,
  ) => {
    const panel = panelRef.current;
    const content = contentRef.current;
    const panelElement = content?.parentElement;
    const groupElement = panelElement?.parentElement;
    if (!panel || !content || !panelElement || !groupElement) return;

    const expanding = panel.isCollapsed();
    if (!expanding && content.style.width === "") {
      content.style.width = `${content.getBoundingClientRect().width}px`;
    }

    groupElement.classList.add("sidebar-layout-animating");
    if (expanding) {
      panel.expand();
      if (content.style.width === "") {
        const groupWidth = groupElement.getBoundingClientRect().width;
        content.style.width = `${(groupWidth * panel.getSize()) / 100}px`;
      }
    } else {
      panel.collapse();
    }

    if (sidebarLayoutAnimationTimeoutRef.current !== null) {
      window.clearTimeout(sidebarLayoutAnimationTimeoutRef.current);
    }
    sidebarLayoutAnimationTimeoutRef.current = window.setTimeout(
      () => finishSidebarLayoutAnimation(groupElement),
      SIDEBAR_LAYOUT_ANIMATION_DURATION_MS,
    );
  };

  useEffect(() => {
    return () => {
      if (sidebarLayoutAnimationTimeoutRef.current !== null) {
        window.clearTimeout(sidebarLayoutAnimationTimeoutRef.current);
      }
    };
  }, []);

  const toggleLeftSidebar = () => {
    toggleSidebar(leftSidebarPanelRef, leftSidebarContentRef);
  };

  const toggleRightSidebar = () => {
    toggleSidebar(rightSidebarPanelRef, rightSidebarContentRef);
  };

  return {
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    leftSidebarContentRef,
    rightSidebarContentRef,
    toggleLeftSidebar,
    toggleRightSidebar,
  };
};
