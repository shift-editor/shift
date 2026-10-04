import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useStableCollapseScroll } from "@/hooks/useStableCollapseScroll";
import { GlyphCatalogView } from "./glyph-catalog";

export const LeftSidebar = () => {
  const { scrollRef, contentRef, spacerRef } = useStableCollapseScroll();

  return (
    <aside
      ref={scrollRef}
      aria-label="Font navigation"
      className="h-full w-full min-w-0 overflow-y-auto border-r border-line-subtle bg-surface"
      style={{ overflowAnchor: "none" }}
    >
      <div ref={contentRef} className="min-h-full space-y-1.5 px-3">
        <Separator />
        <GlyphCatalogView />
        <Separator className="-mx-3 w-auto" />
        <SourcesSection />
        <Separator className="-mx-3 w-auto" />
        <InstancesSection />
        <Separator className="-mx-3 w-auto" />
        <AxesSection />
      </div>
      <div ref={spacerRef} aria-hidden />
    </aside>
  );
};
