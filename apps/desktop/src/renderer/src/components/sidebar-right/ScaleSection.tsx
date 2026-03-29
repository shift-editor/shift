import { useCallback, useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { getEditor } from "@/store/store";
import { anchorToPoint } from "@/lib/transform/anchor";
import { Bounds } from "@shift/geo";
import ScaleIcon from "@/assets/sidebar-right/scale.svg";

export const ScaleSection = () => {
  const editor = getEditor();
  const { anchor, setAnchor } = useTransformOrigin();

  const widthRef = useRef<EditableSidebarInputHandle>(null);
  const heightRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    editor.selectedPointIds.value;
    const bounds = editor.sidebarSelectionBounds.value;

    if (!widthRef.current || !heightRef.current) return;
    if (!bounds) return;

    const width = Bounds.width(bounds);
    const height = Bounds.height(bounds);

    widthRef.current.setValue(Math.round(width));
    heightRef.current.setValue(Math.round(height));
  });

  const handleSizeChange = useCallback(
    (dimension: "width" | "height", value: number) => {
      const bounds = editor.getSelectionBounds();
      if (!bounds) return;

      const current = dimension === "width" ? Bounds.width(bounds) : Bounds.height(bounds);
      if (current === 0) return;

      const factor = value / current;
      const anchorPoint = anchorToPoint(anchor, bounds);
      editor.scaleSelection(factor, factor, anchorPoint);
    },
    [anchor],
  );

  const handleScaleChange = useCallback(
    (scale: number) => {
      const bounds = editor.getSelectionBounds();
      if (!bounds) return;

      const anchorPoint = anchorToPoint(anchor, bounds);
      editor.scaleSelection(scale, scale, anchorPoint);
    },
    [anchor],
  );

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Size</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            ref={widthRef}
            label={<span className="text-xs text-secondary">W</span>}
            onValueChange={(v) => handleSizeChange("width", v)}
          />
          <EditableSidebarInput
            ref={heightRef}
            label="H"
            onValueChange={(v) => handleSizeChange("height", v)}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-secondary">Scale</div>
          <EditableSidebarInput
            className="max-w-18 pl-7"
            value={1}
            suffix="x"
            icon={<ScaleIcon className="w-3.5 h-3.5" />}
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
