import { useCallback, useState, useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { getEditor } from "@/store/store";
import { anchorToPoint, selectionBoundsToRect } from "@/lib/transform/anchor";

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
import DistributeHorizontalIcon from "@/assets/sidebar/distribute-h.svg";
import DistributeVerticalIcon from "@/assets/sidebar/distribute-v.svg";

import { AlignmentType, DistributeType } from "@/lib/transform/types";

export const TransformSection = () => {
  const editor = getEditor();
  const { anchor } = useTransformOrigin();
  const [rotation, setRotation] = useState(0);
  const [pointCount, setPointCount] = useState(0);

  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    const pointIds = editor.selectedPointIds.value;
    setPointCount(pointIds.size);
  });

  useSignalEffect(() => {
    editor.glyph.value;
    const pointIds = editor.selectedPointIds.value;

    if (pointIds.size === 0) {
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    const bounds = editor.getSelectionBounds();
    if (bounds) {
      xRef.current?.setValue(Math.round(bounds.minX));
      yRef.current?.setValue(Math.round(bounds.minY));
    }
  });

  const canDistribute = pointCount >= 3;

  const handleAlign = (alignment: AlignmentType) => {
    editor.alignSelection(alignment);
    editor.requestRedraw();
  };

  const handleDistribute = (type: DistributeType) => {
    editor.distributeSelection(type);
    editor.requestRedraw();
  };

  const getOrigin = () => {
    const bounds = editor.getSelectionBounds();
    if (!bounds) return undefined;
    return anchorToPoint(anchor, selectionBoundsToRect(bounds));
  };

  const handleRotate90 = () => {
    editor.rotate90CW();
  };

  const handleRotate = (angle: number) => {
    const wrapped = angle % 360;
    const radians = (wrapped * Math.PI) / 180;
    editor.rotateSelection(radians, getOrigin());
    setRotation(wrapped);
  };

  const handleFlipH = () => {
    editor.reflectSelection("vertical", getOrigin());
  };

  const handleFlipV = () => {
    editor.reflectSelection("horizontal", getOrigin());
  };

  const handlePositionChange = useCallback(
    (axis: "x" | "y", value: number) => {
      const bounds = editor.getSelectionBounds();
      if (!bounds) return;
      const anchorPoint = anchorToPoint(anchor, selectionBoundsToRect(bounds));
      const target = axis === "x" ? { x: value, y: anchorPoint.y } : { x: anchorPoint.x, y: value };
      editor.moveSelectionTo(target, anchorPoint);
      editor.requestRedraw();
    },
    [anchor],
  );

  return (
    <SidebarSection title="Transform">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Align</div>
        <div className="flex gap-4">
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
          </div>
          <div className="flex gap-1">
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
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Distribute</div>
        <div className="flex gap-1">
          <IconButton
            icon={DistributeHorizontalIcon}
            onClick={() => handleDistribute("horizontal")}
            disabled={!canDistribute}
          />
          <IconButton
            icon={DistributeVerticalIcon}
            onClick={() => handleDistribute("vertical")}
            disabled={!canDistribute}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Position</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            ref={xRef}
            label="X"
            onValueChange={(v) => handlePositionChange("x", v)}
          />
          <EditableSidebarInput
            ref={yRef}
            label="Y"
            onValueChange={(v) => handlePositionChange("y", v)}
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
