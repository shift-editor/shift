import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useSidebarLayout } from "@/components/chrome/useSidebarLayout";

export const Home = () => {
  const {
    leftSidebarContentRef,
    rightSidebarContentRef,
    onLayoutChanged,
    sidebarPanelProps,
    toggleLeftSidebar,
    toggleRightSidebar,
    resetLeftSidebar,
    resetRightSidebar,
  } = useSidebarLayout("home");

  return (
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar toggleLeftSidebar={toggleLeftSidebar} toggleRightSidebar={toggleRightSidebar} />
      <ResizablePanelGroup
        data-testid="home-layout-panels"
        orientation="horizontal"
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 overflow-hidden"
      >
        <ResizablePanel {...sidebarPanelProps("left")}>
          <div ref={leftSidebarContentRef} className="h-full">
            <LeftSidebar />
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize left sidebar"
          inset="start"
          disableDoubleClick
          onDoubleClick={resetLeftSidebar}
        />
        <ResizablePanel id="grid" minSize={300}>
          <GlyphGrid />
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize right sidebar"
          inset="end"
          disableDoubleClick
          onDoubleClick={resetRightSidebar}
        />
        <ResizablePanel {...sidebarPanelProps("right")}>
          <div ref={rightSidebarContentRef} className="h-full">
            <RightSidebar />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
};
