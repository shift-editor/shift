import { useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { SidebarInput } from "./SidebarInput";
import { TransformGrid, type AnchorPosition } from "./TransformGrid";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import ScaleIcon from "@/assets/sidebar/scale.svg";

export const ScaleSection = () => {
  const { width, height, hasSelection } = useSelectionBounds();
  const [anchor, setAnchor] = useState<AnchorPosition>("lm");

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-[8px] text-muted uppercase tracking-wide">
          Size
        </div>
        <div className="flex gap-2">
          <SidebarInput label="W" value={hasSelection ? width : "-"} />
          <SidebarInput label="H" value={hasSelection ? height : "-"} />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-[8px] text-muted uppercase tracking-wide">
            Scale
          </div>
          <SidebarInput
            value={hasSelection ? "1x" : "-"}
            icon={<ScaleIcon className="w-3 h-3" />}
            iconPosition="left"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[8px] text-muted uppercase tracking-wide">
            Anchor point
          </div>
          <TransformGrid activeAnchor={anchor} onChange={setAnchor} />
        </div>
      </div>
    </SidebarSection>
  );
};
