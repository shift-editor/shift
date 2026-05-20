import { Separator } from "@shift/ui";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { GlyphCatalog } from "./glyph-catalog";

import { SidebarSection } from "../editor/sidebar-right/SidebarSection";

export const LeftSidebar = () => (
  <aside className="flex h-full w-full min-w-0 gap-3 flex-col bg-panel px-3 overflow-hidden border-r border-line-subtle">
    <Separator />
    <GlyphCatalog />
    <Separator className="-mx-3 w-auto" />
    <SidebarSection title="Axes">
      <AxesPanel />
    </SidebarSection>
  </aside>
);
