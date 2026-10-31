import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useVariationOutlineControls } from "@/hooks/useVariationOutlineControls";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";

export const VariationPanel = () => {
  const outlines = useVariationOutlineControls();

  return (
    <div className="flex flex-col gap-2 pt-2">
      <AxesSection defaultOpen />
      <Separator className="-mx-1 w-auto" />
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
    </div>
  );
};
