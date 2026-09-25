import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { GlyphCatalogView } from "./glyph-catalog";

export const LeftSidebar = () => (
  <aside
    aria-label="Font navigation"
    className="scrollbar-themed h-full w-full min-w-0 overflow-y-auto border-r border-line-subtle bg-surface"
  >
    <div className="min-h-full space-y-1.5 px-3">
      <Separator />
      <GlyphCatalogView />
      <Separator className="-mx-3 w-auto" />
      <SourcesSection />
      <Separator className="-mx-3 w-auto" />
      <InstancesSection />
      <Separator className="-mx-3 w-auto" />
      <AxesSection />
    </div>
  </aside>
);
