import {
  ScrollArea,
  Separator,
  Tabs,
  TabsIndicator,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@shift/ui";
import { SidebarBrand } from "@/components/chrome/SidebarBrand";
import { PagesSection } from "@/components/pages/PagesSection";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";
import { ObjectsPanel } from "./ObjectsPanel";
import { VariationPanel } from "./VariationPanel";

const TAB_CLASS =
  "h-5 flex-1 rounded-sm px-2 text-ui data-[active]:bg-surface data-[active]:font-medium data-[active]:shadow-sm";

/** The document's lists: its pages and what the canvas holds, or its sources and instances. */
export const LeftSidebar = () => (
  <aside
    aria-label="Layers and designspace"
    className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-line-subtle bg-surface"
  >
    <SidebarBrand />
    <Tabs defaultValue="layers" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-2 mt-2 h-6 shrink-0 gap-0 rounded-md border-0 bg-input p-0.5">
        <TabsTab value="layers" className={TAB_CLASS}>
          Layers
        </TabsTab>
        <TabsTab value="designspace" className={TAB_CLASS}>
          Designspace
        </TabsTab>
        <TabsIndicator className="hidden" />
      </TabsList>
      <Separator className="mt-2 shrink-0" />
      <TabsPanel
        value="layers"
        keepMounted
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="shrink-0 px-1 pt-2">
          <PagesSection section={ObjectSectionRow} />
        </div>
        <Separator className="mt-2 shrink-0" />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ObjectsPanel />
        </div>
      </TabsPanel>
      <TabsPanel value="designspace" keepMounted className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-1 pb-2">
            <VariationPanel />
          </div>
        </ScrollArea>
      </TabsPanel>
    </Tabs>
  </aside>
);
