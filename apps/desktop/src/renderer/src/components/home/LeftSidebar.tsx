import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { GlyphCatalog } from "./glyph-catalog";

export const LeftSidebar = () => (
  <aside className="flex h-full w-full min-w-0 gap-3 flex-col bg-panel px-3 overflow-hidden border-r border-line-subtle">
    <Separator />
    <GlyphCatalog />
    <Separator className="-mx-3 w-auto" />
    <SourcesSection />
    <Separator className="-mx-3 w-auto" />
    <AxesSection />
  </aside>
);
