import { Separator, Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@shift/ui";
import { ObjectsPanel } from "./ObjectsPanel";
import { VariationPanel } from "./VariationPanel";

export const LeftSidebar = () => (
  <aside
    aria-label="Glyph objects and variations"
    className="h-full w-full min-w-0 overflow-hidden border-r border-line-subtle bg-surface"
  >
    <Tabs defaultValue="objects" className="flex h-full min-h-0 flex-col">
      <TabsList className="mx-2 mt-2 h-6 shrink-0 gap-0 rounded-md border-0 bg-input p-0.5">
        <TabsTab
          value="objects"
          className="h-5 flex-1 rounded-sm px-2 text-ui data-[active]:bg-surface data-[active]:font-medium data-[active]:shadow-sm"
        >
          Objects
        </TabsTab>
        <TabsTab
          value="variations"
          className="h-5 flex-1 rounded-sm px-2 text-ui data-[active]:bg-surface data-[active]:font-medium data-[active]:shadow-sm"
        >
          Variations
        </TabsTab>
        <TabsIndicator className="hidden" />
      </TabsList>
      <Separator className="mt-2 shrink-0" />
      <TabsPanel value="objects" keepMounted className="min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-themed h-full overflow-y-auto px-1 pb-2">
          <ObjectsPanel />
        </div>
      </TabsPanel>
      <TabsPanel value="variations" keepMounted className="min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-themed h-full overflow-y-auto px-1 pb-2">
          <VariationPanel />
        </div>
      </TabsPanel>
    </Tabs>
  </aside>
);
