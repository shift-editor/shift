import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";
import { GlyphCatalogProvider } from "@/context/GlyphCatalogProvider";
import { useFontSession } from "@/workspace/WorkspaceContext";

export const Home = () => {
  const authored = useFontSession().workspace !== null;

  return (
    <GlyphCatalogProvider>
      <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
        {authored ? <Toolbar /> : <header className="min-h-12 bg-toolbar" />}
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
            {authored ? (
              <LeftSidebar />
            ) : (
              <aside className="h-full w-full border-r border-line-subtle bg-panel" />
            )}
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
            {authored ? (
              <RightSidebar />
            ) : (
              <aside className="h-full w-full border-l border-line-subtle bg-panel" />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </GlyphCatalogProvider>
  );
};
