import { useCallback } from "react";
import { Button } from "@shift/ui";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarInput } from "./SidebarInput";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { getEditor } from "@/store/store";
import { anchorToPoint } from "@/lib/transform/anchor";
import RotateIcon from "@/assets/sidebar/rotate.svg";
import RotateCwIcon from "@/assets/sidebar/rotate-cw.svg";
import FlipHIcon from "@/assets/sidebar/flip-h.svg";
import FlipVIcon from "@/assets/sidebar/flip-v.svg";

export const TransformSection = () => {
  const editor = getEditor();
  const { x, y, hasSelection, bounds } = useSelectionBounds();
  const { anchor } = useTransformOrigin();

  const getOrigin = () => {
    if (!bounds) return undefined;
    return anchorToPoint(anchor, bounds);
  };

  const handleRotate90 = () => {
    editor.rotateSelection(Math.PI / 2, getOrigin());
    editor.requestRedraw();
  };

  const handleFlipH = () => {
    editor.reflectSelection("horizontal", getOrigin());
    editor.requestRedraw();
  };

  const handleFlipV = () => {
    editor.reflectSelection("vertical", getOrigin());
    editor.requestRedraw();
  };

  const handleXChange = useCallback(
    (newX: number) => {
      if (!bounds) return;
      const anchorPoint = anchorToPoint(anchor, bounds);
      editor.moveSelectionTo({ x: newX, y: anchorPoint.y }, anchorPoint);
      editor.requestRedraw();
    },
    [bounds, anchor, editor],
  );

  const handleYChange = useCallback(
    (newY: number) => {
      if (!bounds) return;
      const anchorPoint = anchorToPoint(anchor, bounds);
      editor.moveSelectionTo({ x: anchorPoint.x, y: newY }, anchorPoint);
      editor.requestRedraw();
    },
    [bounds, anchor, editor],
  );

  return (
    <SidebarSection title="Transform">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-[#898989]">Position</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            label="X"
            value={x}
            onValueChange={handleXChange}
            disabled={!hasSelection}
          />
          <EditableSidebarInput
            label="Y"
            value={y}
            onValueChange={handleYChange}
            disabled={!hasSelection}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-muted">Rotation</div>
        <div className="flex gap-2 items-center">
          <SidebarInput
            label=""
            value={hasSelection ? "0" : "-"}
            icon={<RotateIcon className="w-3 h-3" />}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleRotate90}
            disabled={!hasSelection}
          >
            <RotateCwIcon className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleFlipH}
            disabled={!hasSelection}
          >
            <FlipHIcon className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleFlipV}
            disabled={!hasSelection}
          >
            <FlipVIcon className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </SidebarSection>
  );
};
