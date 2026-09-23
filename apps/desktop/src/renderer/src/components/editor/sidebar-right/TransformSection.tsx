import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";
import { Bounds, Mat, Vec2, type PointAxis } from "@shift/geo";
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

import { AlignmentType, DistributeType } from "@shift/editor/transform";

const AlignButtonsRow = React.memo(function AlignButtonsRow({
  onAlign,
  canAlign,
}: {
  onAlign: (a: AlignmentType) => void;
  canAlign: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <div className="flex gap-1">
        <IconButton
          ariaLabel="Align left"
          icon={AlignLeftIcon}
          onClick={() => onAlign("left")}
          disabled={!canAlign}
        />
        <IconButton
          ariaLabel="Align horizontal centers"
          icon={AlignCenterHIcon}
          onClick={() => onAlign("center-h")}
          disabled={!canAlign}
        />
        <IconButton
          ariaLabel="Align right"
          icon={AlignRightIcon}
          onClick={() => onAlign("right")}
          disabled={!canAlign}
        />
      </div>
      <div className="flex gap-1">
        <IconButton
          ariaLabel="Align top"
          icon={AlignTopIcon}
          onClick={() => onAlign("top")}
          disabled={!canAlign}
        />
        <IconButton
          ariaLabel="Align vertical centers"
          icon={AlignCenterVIcon}
          onClick={() => onAlign("center-v")}
          disabled={!canAlign}
        />
        <IconButton
          ariaLabel="Align bottom"
          icon={AlignBottomIcon}
          onClick={() => onAlign("bottom")}
          disabled={!canAlign}
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
  const componentSelection = useMemo(
    () => editor.componentTransformSelection(selection.ids),
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
  const editable = positionSelection !== null || componentSelection !== null;

  useEffect(() => {
    if (!editable) {
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    if (!selectionBounds) return;

    xRef.current?.setValue(Math.round(selectionBounds.min.x));
    yRef.current?.setValue(Math.round(selectionBounds.min.y));
  }, [editable, selectionBounds]);

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
      if (!editable || !selectionBounds) return;

      const current =
        dimension === "width" ? Bounds.width(selectionBounds) : Bounds.height(selectionBounds);
      if (current === 0) return;

      const factor = value / current;
      const sx = dimension === "width" ? factor : 1;
      const sy = dimension === "height" ? factor : 1;

      if (componentSelection && !isEditing) {
        componentSelection.layer.transformComponents(
          componentSelection,
          "Resize components",
          ({ bounds }) => {
            const origin = { x: bounds.x, y: bounds.y + bounds.height };
            return Mat.Compose(
              Mat.Translate(origin.x, origin.y),
              Mat.Compose(Mat.Scale(sx, sy), Mat.Translate(-origin.x, -origin.y)),
            );
          },
        );
        return;
      }

      if (!layer) return;

      const anchorPoint = { x: selectionBounds.min.x, y: selectionBounds.max.y };
      layer.scale(selectedPointIds, sx, sy, anchorPoint);
    },
    [componentSelection, editable, isEditing, layer, selectedPointIds, selectionBounds],
  );

  const canDistribute = editable && selectedPointIds.length >= 3;
  const canAlign = editable && selectedPointIds.length >= 2;

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
    if (!editable || !origin) return;

    if (componentSelection && !isEditing) {
      componentSelection.layer.transformComponents(
        componentSelection,
        "Rotate components",
        ({ bounds }) => {
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return Mat.Compose(
            Mat.Translate(center.x, center.y),
            Mat.Compose(Mat.Rotate(-Math.PI / 2), Mat.Translate(-center.x, -center.y)),
          );
        },
      );
      return;
    }

    if (!layer) return;

    layer.rotate(selectedPointIds, -Math.PI / 2, origin);
  };

  const handleRotate = (angle: number) => {
    if (!editable || !origin) return;

    const wrapped = angle % 360;
    const radians = (wrapped * Math.PI) / 180;
    if (componentSelection && !isEditing) {
      componentSelection.layer.transformComponents(
        componentSelection,
        "Rotate components",
        ({ bounds }) => {
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return Mat.Compose(
            Mat.Translate(center.x, center.y),
            Mat.Compose(Mat.Rotate(radians), Mat.Translate(-center.x, -center.y)),
          );
        },
      );
    } else if (layer) {
      layer.rotate(selectedPointIds, radians, origin);
    }
    setRotation(wrapped);
  };

  const handleFlipH = () => {
    if (!editable || !origin) return;

    if (componentSelection && !isEditing) {
      componentSelection.layer.transformComponents(
        componentSelection,
        "Flip components horizontally",
        ({ bounds }) => {
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return Mat.Compose(
            Mat.Translate(center.x, center.y),
            Mat.Compose(Mat.ReflectVertical(), Mat.Translate(-center.x, -center.y)),
          );
        },
      );
      return;
    }

    if (!layer) return;

    layer.reflect(selectedPointIds, "vertical", origin);
  };

  const handleFlipV = () => {
    if (!editable || !origin) return;

    if (componentSelection && !isEditing) {
      componentSelection.layer.transformComponents(
        componentSelection,
        "Flip components vertically",
        ({ bounds }) => {
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return Mat.Compose(
            Mat.Translate(center.x, center.y),
            Mat.Compose(Mat.ReflectHorizontal(), Mat.Translate(-center.x, -center.y)),
          );
        },
      );
      return;
    }

    if (!layer) return;

    layer.reflect(selectedPointIds, "horizontal", origin);
  };

  const handlePositionChange = useCallback(
    (axis: PointAxis, value: number) => {
      if (!editable || !selectionBounds) return;

      const position = selectionBounds.min;
      if (componentSelection && !isEditing) {
        const delta = Vec2.fromAxis(axis, value - position[axis]);
        componentSelection.layer.transformComponents(componentSelection, "Move components", () =>
          Mat.Translate(delta.x, delta.y),
        );
        return;
      }

      if (!layer) return;

      const target = Vec2.setAxis(position, axis, value);
      layer.moveSelectionTo([...selectedPointIds], target, position);
    },
    [componentSelection, editable, isEditing, layer, selectedPointIds, selectionBounds],
  );

  return (
    <SidebarSection title="Transform">
      <div className="flex flex-col gap-2">
        <div className="text-ui text-secondary">Align</div>
        <AlignButtonsRow canAlign={canAlign} onAlign={handleAlign} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-ui text-secondary">Distribute</div>
        <DistributeButtonsRow onDistribute={handleDistribute} canDistribute={canDistribute} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-ui text-secondary">Dimensions</div>
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
        <div className="text-ui text-secondary">Position</div>
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
        <div className="text-ui text-secondary">Rotation</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-24 shrink-0">
            <EditableSidebarInput
              ariaLabel="Rotation"
              className="bg-input pl-8"
              value={rotation}
              suffix="°"
              defaultValue={0}
              disabled={!editable}
              onValueChange={handleRotate}
              iconPosition="left"
              icon={<RotateIcon className="w-5 h-5 text-sidebar-icon" />}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              className="p-[3px]"
              ariaLabel="Rotate 90 degrees clockwise"
              icon={RotateCwIcon}
              disabled={!editable}
              onClick={handleRotate90}
            />
            <IconButton
              className="p-[3px]"
              ariaLabel="Flip horizontally"
              icon={FlipHIcon}
              disabled={!editable}
              onClick={handleFlipH}
            />
            <IconButton
              className="p-[3px]"
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
