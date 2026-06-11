import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";
import { GlyphCatalogProvider } from "@/context/GlyphCatalogContext";
import { SkeletonPanel } from "@/components/debug/SkeletonPanel";

export const Home = () => (
  <GlyphCatalogProvider>
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar />
      <SkeletonPanel />
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="shift:home-layout"
        className="min-h-0 overflow-hidden"
      >
        <ResizablePanel
          id="left-sidebar"
          order={1}
          defaultSize={16}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <LeftSidebar />
        </ResizablePanel>
        <ResizableHandle inset="start" />
        <ResizablePanel id="grid" order={2} minSize={30}>
          <GlyphGrid />
        </ResizablePanel>
        <ResizableHandle inset="end" />
        <ResizablePanel
          id="right-sidebar"
          order={3}
          defaultSize={15}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <RightSidebar />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  </GlyphCatalogProvider>
);
