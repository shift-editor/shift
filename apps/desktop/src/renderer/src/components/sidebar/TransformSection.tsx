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
import AlignLeftIcon from "@/assets/sidebar/align-left.svg";
import AlignCenterHIcon from "@/assets/sidebar/align-center-h.svg";
import AlignRightIcon from "@/assets/sidebar/align-right.svg";
import AlignTopIcon from "@/assets/sidebar/align-top.svg";
import AlignCenterVIcon from "@/assets/sidebar/align-center-v.svg";
import AlignBottomIcon from "@/assets/sidebar/align-bottom.svg";
import { Button } from "@shift/ui";
import { AlignmentType, DistributeType } from "@/lib/transform/types";

export const TransformSection = () => {
  const editor = getEditor();
  const { x, y, hasSelection, bounds, pointCount } = useSelectionBounds();
  const { anchor } = useTransformOrigin();
  const [rotation, setRotation] = useState(0);

  const canDistribute = pointCount >= 3;
  console.log("canDistribute", canDistribute);

  const handleAlign = (alignment: AlignmentType) => {
    editor.alignSelection(alignment);
    editor.requestRedraw();
  };

  const handleDistribute = (type: DistributeType) => {
    editor.distributeSelection(type);
    editor.requestRedraw();
  };

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
        <div className="text-xs text-secondary">Align</div>
        <div className="flex gap-1">
          <IconButton
            icon={AlignLeftIcon}
            onClick={() => handleAlign("left")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={AlignCenterHIcon}
            onClick={() => handleAlign("center-h")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={AlignRightIcon}
            onClick={() => handleAlign("right")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={AlignTopIcon}
            onClick={() => handleAlign("top")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={AlignCenterVIcon}
            onClick={() => handleAlign("center-v")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={AlignBottomIcon}
            onClick={() => handleAlign("bottom")}
            disabled={!canDistribute}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Distribute</div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleDistribute("horizontal")}
            disabled={!canDistribute}
            title="Distribute Horizontal"
          >
            DH
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleDistribute("vertical")}
            disabled={!canDistribute}
            title="Distribute Vertical"
          >
            DV
          </Button>
        </div>
      </div>
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
