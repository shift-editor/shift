import { useCallback, useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
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
  const [rotation, setRotation] = useState(0);

  const getOrigin = () => {
    if (!bounds) return undefined;
    return anchorToPoint(anchor, bounds);
  };

  const handleRotate90 = () => {
    editor.transform.rotate90CW();
  };

  const handleRotate = (angle: number) => {
    const wrapped = angle % 360;
    const radians = (wrapped * Math.PI) / 180;
    editor.transform.rotate(radians, getOrigin());
    setRotation(wrapped);
  };

  const handleFlipH = () => {
    editor.reflectSelection("vertical", getOrigin());
  };

  const handleFlipV = () => {
    editor.reflectSelection("horizontal", getOrigin());
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
        <div className="text-xs text-secondary">Position</div>
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
        <div className="text-xs text-secondary">Rotation</div>
        <div className="flex gap-2 items-center">
          <EditableSidebarInput
            className="max-w-32"
            value={rotation}
            suffix="°"
            defaultValue={0}
            onValueChange={handleRotate}
            icon={<RotateIcon className="w-5 h-5" />}
          />
          <div className="flex w-full items-center justify-start gap-1">
            <IconButton icon={RotateCwIcon} onClick={handleRotate90} />
            <IconButton icon={FlipHIcon} onClick={handleFlipH} />
            <IconButton icon={FlipVIcon} onClick={handleFlipV} />
          </div>
        </div>
      </div>
    </SidebarSection>
  );
};
