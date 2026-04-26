import { Separator } from "@shift/ui";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { GlyphCatalog } from "./glyph-catalog";
import { SidebarSection } from "../editor/sidebar-right/SidebarSection";

export const LeftSidebar = () => (
  <aside className="flex h-full gap-3 w-[260px] flex-col border-r border-line-subtle bg-panel px-3">
    <Separator />
    <GlyphCatalog />
    <Separator className="-mx-3 w-auto" />
    <SidebarSection title="Axes">
      <AxesPanel />
    </SidebarSection>
  </aside>
);
