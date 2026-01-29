import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import ScaleIcon from "@/assets/sidebar/scale.svg";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { getEditor } from "@/store/store";
import { anchorToPoint } from "@/lib/transform/anchor";

export const ScaleSection = () => {
  const editor = getEditor();
  const { bounds, width, height } = useSelectionBounds();
  const { anchor, setAnchor } = useTransformOrigin();
  const anchorPoint = bounds ? anchorToPoint(anchor, bounds) : undefined;

  const handleWidthChange = (newWidth: number) => {
    if (!bounds) return;
    const factor = newWidth / width;
    editor.scaleSelection(factor, factor, anchorPoint);
  };

  const handleHeightChange = (newHeight: number) => {
    if (!bounds) return;
    const factor = newHeight / height;
    editor.scaleSelection(factor, factor, anchorPoint);
  };

  const handleScaleChange = (newScale: number) => {
    if (!bounds) return;
    editor.scaleSelection(newScale, newScale, anchorPoint);
  };

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Size</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            label={<span className="text-xs text-secondary">W</span>}
            value={width}
            onValueChange={handleWidthChange}
          />
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
            icon={<ScaleIcon className="w-4 h-4" />}
            iconPosition="left"
            onValueChange={handleScaleChange}
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
