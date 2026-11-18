import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { ComponentLocationSection } from "@/components/variation/ComponentLocationSection";
import { GlyphAxesSection } from "@/components/variation/GlyphAxesSection";
import { GlyphSourcesSection } from "@/components/variation/GlyphSourcesSection";
import { useVariationOutlineControls } from "@/hooks/useVariationOutlineControls";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";

/**
 * The Designspace tab: the font's sources and instances, the edited glyph's
 * own sources, then where the font is drawn (Font axes), the edited glyph's
 * own axes and, while components are selected, where they draw their base
 * glyphs.
 */
export const VariationPanel = () => {
  const outlines = useVariationOutlineControls();

  return (
    <div className="flex flex-col gap-2">
      <SourcesSection
        defaultOpen
        section={ObjectSectionRow}
        outlineControls={outlines.sourceControls}
      />
      <Separator className="-mx-1 w-auto" />
      <InstancesSection
        defaultOpen
        section={ObjectSectionRow}
        outlineControls={outlines.instanceControls}
      />
      {/* While a glyph is edited; it brings its own divider. */}
      <GlyphSourcesSection section={ObjectSectionRow} />
      <Separator className="-mx-1 w-auto" />
      <AxesSection defaultOpen />
      {/* While the glyph has axes of its own; it brings its own divider. */}
      <GlyphAxesSection />
      {/* Only while components are selected; it brings its own divider. */}
      <ComponentLocationSection />
    </div>
  );
};
