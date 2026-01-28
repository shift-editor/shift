import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import ScaleIcon from "@/assets/sidebar/scale.svg";
import { EditableSidebarInput } from "./EditableSidebarInput";

export const ScaleSection = () => {
  const { width, height } = useSelectionBounds();
  const { anchor, setAnchor } = useTransformOrigin();

  const handleWidthChange = (_: number) => {};
  const handleHeightChange = (_: number) => {};

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Size</div>
        <div className="flex gap-2">
          <EditableSidebarInput label="W" value={width} onValueChange={handleWidthChange} />
          <EditableSidebarInput label="H" value={height} onValueChange={handleHeightChange} />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-secondary">Scale</div>
          <EditableSidebarInput
            className="max-w-18"
            value={1}
            suffix="x"
            icon={<ScaleIcon className="w-3 h-3" />}
            iconPosition="left"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs text-secondary">Anchor point</div>
          <div className="w-full h-full bg-input p-1.5 rounded-sm">
            <TransformGrid activeAnchor={anchor} onChange={setAnchor} />
          </div>
        </div>
      </div>
    </SidebarSection>
  );
};
