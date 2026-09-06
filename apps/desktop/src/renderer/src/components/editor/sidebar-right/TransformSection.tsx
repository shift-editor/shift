import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import { Bounds } from "@shift/geo";
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
          ariaLabel="Align left"
          icon={AlignLeftIcon}
          onClick={() => onAlign("left")}
          disabled={!canDistribute}
        />
        <IconButton
          ariaLabel="Align horizontal centers"
          icon={AlignCenterHIcon}
          onClick={() => onAlign("center-h")}
          disabled={!canDistribute}
        />
        <IconButton
          ariaLabel="Align right"
          icon={AlignRightIcon}
          onClick={() => onAlign("right")}
          disabled={!canDistribute}
        />
      </div>
      <div className="flex gap-1">
        <IconButton
          ariaLabel="Align top"
          icon={AlignTopIcon}
          onClick={() => onAlign("top")}
          disabled={!canDistribute}
        />
        <IconButton
          ariaLabel="Align vertical centers"
          icon={AlignCenterVIcon}
          onClick={() => onAlign("center-v")}
          disabled={!canDistribute}
        />
        <IconButton
          ariaLabel="Align bottom"
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
        ariaLabel="Distribute horizontally"
        icon={DistributeHorizontalIcon}
        onClick={() => onDistribute("horizontal")}
        disabled={!canDistribute}
      />
      <IconButton
        ariaLabel="Distribute vertically"
        icon={DistributeVerticalIcon}
        onClick={() => onDistribute("vertical")}
        disabled={!canDistribute}
      />
    </div>
  );
});

export const TransformSection = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell);
  const positionSelection = useMemo(
    () => editor.positionSelection(selection.ids),
    [editor, selection],
  );
  const selectedPointIds = positionSelection?.targets.points ?? [];
  const isEditing = useSignalState(editor.isEditingCell);
  const selectionBounds = useSelectionBounds();
  const [rotation, setRotation] = useState(0);

  const widthRef = useRef<EditableSidebarInputHandle>(null);
  const heightRef = useRef<EditableSidebarInputHandle>(null);
  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);
  const layer = isEditing ? null : (positionSelection?.layer ?? null);

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

  useEffect(() => {
    if (!widthRef.current || !heightRef.current) return;
    if (!selectionBounds) return;

    const width = Bounds.width(selectionBounds);
    const height = Bounds.height(selectionBounds);

    widthRef.current.setValue(Math.round(width));
    heightRef.current.setValue(Math.round(height));
  }, [selectionBounds]);

  const handleDimensionsChange = useCallback(
    (dimension: "width" | "height", value: number) => {
      if (!layer) return;
      if (!selectionBounds) return;

      const current =
        dimension === "width" ? Bounds.width(selectionBounds) : Bounds.height(selectionBounds);
      if (current === 0) return;

      const factor = value / current;
      const anchorPoint = { x: selectionBounds.min.x, y: selectionBounds.max.y };
      layer.scale(
        selectedPointIds,
        dimension === "width" ? factor : 1,
        dimension === "height" ? factor : 1,
        anchorPoint,
      );
    },
    [layer, selectedPointIds, selectionBounds],
  );

  const editable = positionSelection !== null;
  const canDistribute = editable && selectedPointIds.length >= 3;

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
    () => (selectionBounds ? Bounds.center(selectionBounds) : undefined),
    [selectionBounds],
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

      const position = selectionBounds.min;
      const target = axis === "x" ? { x: value, y: position.y } : { x: position.x, y: value };
      layer.moveSelectionTo([...selectedPointIds], target, position);
    },
    [layer, selectedPointIds, selectionBounds],
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
        <div className="text-xs text-secondary">Dimensions</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            ref={widthRef}
            ariaLabel="Dimension width"
            label="W"
            disabled={!editable}
            onValueChange={(v) => handleDimensionsChange("width", v)}
          />
          <EditableSidebarInput
            ref={heightRef}
            ariaLabel="Dimension height"
            label="H"
            disabled={!editable}
            onValueChange={(v) => handleDimensionsChange("height", v)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Position</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            ref={xRef}
            ariaLabel="X position"
            label="X"
            disabled={!editable}
            onValueChange={(v) => handlePositionChange("x", v)}
          />
          <EditableSidebarInput
            ref={yRef}
            ariaLabel="Y position"
            label="Y"
            disabled={!editable}
            onValueChange={(v) => handlePositionChange("y", v)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Rotation</div>
        <div className="flex gap-2 items-center">
          <EditableSidebarInput
            ariaLabel="Rotation"
            className="max-w-32"
            value={rotation}
            suffix="°"
            defaultValue={0}
            disabled={!editable}
            onValueChange={handleRotate}
            icon={<RotateIcon className="w-5 h-5" />}
          />
          <div className="flex w-full items-center justify-start gap-1">
            <IconButton
              ariaLabel="Rotate 90 degrees clockwise"
              icon={RotateCwIcon}
              disabled={!editable}
              onClick={handleRotate90}
            />
            <IconButton
              ariaLabel="Flip horizontally"
              icon={FlipHIcon}
              disabled={!editable}
              onClick={handleFlipH}
            />
            <IconButton
              ariaLabel="Flip vertically"
              icon={FlipVIcon}
              disabled={!editable}
              onClick={handleFlipV}
            />
          </div>
        </div>
      </div>
    </SidebarSection>
  );
};
