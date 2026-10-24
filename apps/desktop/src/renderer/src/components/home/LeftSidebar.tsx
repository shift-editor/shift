import { ScrollArea, Separator } from "@shift/ui";
import { ObjectSectionRow } from "@/components/editor/object-tree/ObjectSectionRow";
import { PagesSection } from "@/components/pages/PagesSection";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useStableCollapseScroll } from "@/hooks/useStableCollapseScroll";
import { GlyphCatalogView } from "./glyph-catalog";

export const LeftSidebar = () => {
  const { scrollRef, contentRef, spacerRef } = useStableCollapseScroll();

  return (
    <aside
      aria-label="Font navigation"
      className="h-full w-full min-w-0 border-r border-line-subtle bg-surface"
    >
      <ScrollArea
        className="h-full"
        viewportRef={scrollRef}
        viewportStyle={{ overflowAnchor: "none" }}
      >
        {/* The editor sidebar's sections, guide lines, and order, so Home and the editor read alike. */}
        <div ref={contentRef} className="flex min-h-full flex-col gap-2 px-1 pt-2">
          <PagesSection section={ObjectSectionRow} />
          <Separator className="-mx-1 w-auto" />
          <GlyphCatalogView />
          <Separator className="-mx-1 w-auto" />
          <AxesSection />
          <Separator className="-mx-1 w-auto" />
          <SourcesSection section={ObjectSectionRow} />
          <Separator className="-mx-1 w-auto" />
          <InstancesSection section={ObjectSectionRow} />
        </div>
        <div ref={spacerRef} aria-hidden />
      </ScrollArea>
    </aside>
  );
};
