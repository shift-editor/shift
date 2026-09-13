import { useRef } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
} from "@shift/ui";
import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";

const LEFT_SIDEBAR_DEFAULT_SIZE = 15;
const RIGHT_SIDEBAR_DEFAULT_SIZE = 15;

export const Home = () => {
  const leftSidebarPanelRef = useRef<ResizablePanelHandle>(null);
  const rightSidebarPanelRef = useRef<ResizablePanelHandle>(null);
  const leftSidebarContentRef = useRef<HTMLDivElement>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarLayoutAnimationTimeoutRef = useRef<number | null>(null);

  const toggleLeftSidebar = () => {
    const panel = leftSidebarPanelRef.current;
    const content = leftSidebarContentRef.current;
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
    sidebarLayoutAnimationTimeoutRef.current = window.setTimeout(() => {
      groupElement.classList.remove("sidebar-layout-animating");
      if (leftSidebarPanelRef.current?.isExpanded() && leftSidebarContentRef.current) {
        leftSidebarContentRef.current.style.width = "";
      }
      if (rightSidebarPanelRef.current?.isExpanded() && rightSidebarContentRef.current) {
        rightSidebarContentRef.current.style.width = "";
      }
      sidebarLayoutAnimationTimeoutRef.current = null;
    }, 150);
  };

  const toggleRightSidebar = () => {
    const panel = rightSidebarPanelRef.current;
    const content = rightSidebarContentRef.current;
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
    sidebarLayoutAnimationTimeoutRef.current = window.setTimeout(() => {
      groupElement.classList.remove("sidebar-layout-animating");
      if (leftSidebarPanelRef.current?.isExpanded() && leftSidebarContentRef.current) {
        leftSidebarContentRef.current.style.width = "";
      }
      if (rightSidebarPanelRef.current?.isExpanded() && rightSidebarContentRef.current) {
        rightSidebarContentRef.current.style.width = "";
      }
      sidebarLayoutAnimationTimeoutRef.current = null;
    }, 150);
  };

  return (
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar toggleLeftSidebar={toggleLeftSidebar} toggleRightSidebar={toggleRightSidebar} />
      <ResizablePanelGroup
        data-testid="home-layout-panels"
        direction="horizontal"
        autoSaveId="shift:home-layout"
        className="min-h-0 overflow-hidden"
      >
        <ResizablePanel
          ref={leftSidebarPanelRef}
          className="sidebar-panel"
          data-testid="left-sidebar-panel"
          id="left-sidebar"
          order={1}
          defaultSize={LEFT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <div ref={leftSidebarContentRef} className="h-full">
            <LeftSidebar />
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize left sidebar"
          inset="start"
          onDoubleClick={() => leftSidebarPanelRef.current?.resize(LEFT_SIDEBAR_DEFAULT_SIZE)}
        />
        <ResizablePanel id="grid" order={2} minSize={30}>
          <GlyphGrid />
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize right sidebar"
          inset="end"
          onDoubleClick={() => rightSidebarPanelRef.current?.resize(RIGHT_SIDEBAR_DEFAULT_SIZE)}
        />
        <ResizablePanel
          ref={rightSidebarPanelRef}
          className="sidebar-panel"
          data-testid="right-sidebar-panel"
          id="right-sidebar"
          order={3}
          defaultSize={RIGHT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <div ref={rightSidebarContentRef} className="h-full">
            <RightSidebar />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
};
