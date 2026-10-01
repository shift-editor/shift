import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useSidebarLayout } from "@/components/chrome/useSidebarLayout";

const LEFT_SIDEBAR_DEFAULT_SIZE = 15;
const RIGHT_SIDEBAR_DEFAULT_SIZE = 15;

export const Home = () => {
  const {
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    leftSidebarContentRef,
    rightSidebarContentRef,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useSidebarLayout();

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
