import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { anchorToPoint } from "@/lib/transform/anchor";
import { useSignalState } from "@/lib/signals";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";

import RotateIcon from "@/assets/sidebar-right/rotate.svg";
import RotateCwIcon from "@/assets/sidebar-right/rotate-cw.svg";
import FlipHIcon from "@/assets/sidebar-right/flip-h.svg";
import FlipVIcon from "@/assets/sidebar-right/flip-v.svg";
import AlignLeftIcon from "@/assets/sidebar-right/align-left.svg";
import AlignCenterHIcon from "@/assets/sidebar-right/align-center-h.svg";
import AlignRightIcon from "@/assets/sidebar-right/align-right.svg";
import AlignTopIcon from "@/assets/sidebar-right/align-top.svg";
import AlignCenterVIcon from "@/assets/sidebar-right/align-center-v.svg";
import AlignBottomIcon from "@/assets/sidebar-right/align-bottom.svg";
import DistributeHorizontalIcon from "@/assets/sidebar-right/distribute-h.svg";
import DistributeVerticalIcon from "@/assets/sidebar-right/distribute-v.svg";

import { AlignmentType, DistributeType } from "@/lib/transform/types";
import { isPointId } from "@shift/types";

const AlignButtonsRow = React.memo(function AlignButtonsRow({
  onAlign,
  canDistribute,
}: {
  onAlign: (a: AlignmentType) => void;
  canDistribute: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex gap-1">
        <IconButton
          icon={AlignLeftIcon}
          onClick={() => onAlign("left")}
          disabled={!canDistribute}
        />
        <IconButton
          icon={AlignCenterHIcon}
          onClick={() => onAlign("center-h")}
          disabled={!canDistribute}
        />
        <IconButton
          icon={AlignRightIcon}
          onClick={() => onAlign("right")}
          disabled={!canDistribute}
        />
      </div>
      <div className="flex gap-1">
        <IconButton icon={AlignTopIcon} onClick={() => onAlign("top")} disabled={!canDistribute} />
        <IconButton
          icon={AlignCenterVIcon}
          onClick={() => onAlign("center-v")}
          disabled={!canDistribute}
        />
        <IconButton
          icon={AlignBottomIcon}
          onClick={() => onAlign("bottom")}
          disabled={!canDistribute}
        />
      </div>
    </div>
  );
});

const DistributeButtonsRow = React.memo(function DistributeButtonsRow({
  onDistribute,
  canDistribute,
}: {
  onDistribute: (t: DistributeType) => void;
  canDistribute: boolean;
}) {
  return (
    <div className="flex gap-1">
      <IconButton
        icon={DistributeHorizontalIcon}
        onClick={() => onDistribute("horizontal")}
        disabled={!canDistribute}
      />
      <IconButton
        icon={DistributeVerticalIcon}
        onClick={() => onDistribute("vertical")}
        disabled={!canDistribute}
      />
    </div>
  );
});

export const TransformSection = () => {
  const editor = useEditor();
  const sourceId = useActiveSourceId();
  const scene = useSignalState(editor.scene.cell);
  const { anchor } = useTransformOrigin();
  const selection = useSignalState(editor.selection.stateCell);
  const selectedPointIds = useMemo(() => selection.ids.filter(isPointId), [selection]);
  const selectionBounds = useSelectionBounds();
  const [rotation, setRotation] = useState(0);

  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);
  const layer = useMemo(() => {
    if (!sourceId) return null;

    const glyphNodes = scene.nodes.filter((node) => node.kind === "glyph");
    if (glyphNodes.length !== 1) return null;

    const [node] = glyphNodes;
    if (!node) return null;

    return editor.font.layer(node.glyphId, sourceId);
  }, [editor, scene, sourceId]);

  useEffect(() => {
    if (selectedPointIds.length === 0) {
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    if (!selectionBounds) return;

    xRef.current?.setValue(Math.round(selectionBounds.min.x));
    yRef.current?.setValue(Math.round(selectionBounds.min.y));
  }, [selectedPointIds, selectionBounds]);

  const canDistribute = selectedPointIds.length >= 3;

  const handleAlign = useCallback(
    (alignment: AlignmentType) => {
      if (!layer) return;

      layer.align(selectedPointIds, alignment);
    },
    [layer, selectedPointIds],
  );

  const handleDistribute = useCallback(
    (type: DistributeType) => {
      if (!layer) return;

      layer.distribute(selectedPointIds, type);
    },
    [layer, selectedPointIds],
  );

  const origin = useMemo(
    () => (selectionBounds ? anchorToPoint(anchor, selectionBounds) : undefined),
    [anchor, selectionBounds],
  );

  const handleRotate90 = () => {
    if (!layer || !origin) return;

    layer.rotate(selectedPointIds, -Math.PI / 2, origin);
  };

  const handleRotate = (angle: number) => {
    if (!layer || !origin) return;

    const wrapped = angle % 360;
    const radians = (wrapped * Math.PI) / 180;
    layer.rotate(selectedPointIds, radians, origin);
    setRotation(wrapped);
  };

  const handleFlipH = () => {
    if (!layer || !origin) return;

    layer.reflect(selectedPointIds, "vertical", origin);
  };

  const handleFlipV = () => {
    if (!layer || !origin) return;

    layer.reflect(selectedPointIds, "horizontal", origin);
  };

  const handlePositionChange = useCallback(
    (axis: "x" | "y", value: number) => {
      if (!layer) return;
      if (!selectionBounds) return;

      const anchorPoint = anchorToPoint(anchor, selectionBounds);
      const target = axis === "x" ? { x: value, y: anchorPoint.y } : { x: anchorPoint.x, y: value };
      layer.moveSelectionTo([...selectedPointIds], target, anchorPoint);
    },
    [anchor, layer, selectedPointIds, selectionBounds],
  );

  return (
    <SidebarSection title="Transform">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Align</div>
        <AlignButtonsRow onAlign={handleAlign} canDistribute={canDistribute} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Distribute</div>
        <DistributeButtonsRow onDistribute={handleDistribute} canDistribute={canDistribute} />
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
