import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useVariationOutlineControls } from "@/hooks/useVariationOutlineControls";

export const VariationPanel = () => {
  const outlines = useVariationOutlineControls();

  return (
    <div className="flex flex-col gap-2 pt-2">
      <SourcesSection defaultOpen outlineControls={outlines.sourceControls} />
      <Separator />
      <InstancesSection defaultOpen outlineControls={outlines.instanceControls} />
      <Separator />
      <AxesSection defaultOpen />
    </div>
  );
};
