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

  return (
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar />
      <ResizablePanelGroup
        data-testid="home-layout-panels"
        direction="horizontal"
        autoSaveId="shift:home-layout"
        className="min-h-0 overflow-hidden"
      >
        <ResizablePanel
          ref={leftSidebarPanelRef}
          data-testid="left-sidebar-panel"
          id="left-sidebar"
          order={1}
          defaultSize={LEFT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <LeftSidebar />
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
          data-testid="right-sidebar-panel"
          id="right-sidebar"
          order={3}
          defaultSize={RIGHT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <RightSidebar />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
};
