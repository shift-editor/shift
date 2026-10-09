import { useCallback, useMemo } from "react";
import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { SidebarNumberField } from "./SidebarNumberField";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { anchorToPoint } from "@shift/editor/transform";
import { useSignalState } from "@shift/editor/signals";
import { Bounds, Mat } from "@shift/geo";
import ScaleIcon from "@/assets/sidebar-right/scale.svg";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";

export const ScaleSection = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const { anchor, setAnchor } = useTransformOrigin();
  const selectionBounds = useSelectionBounds();

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
  const layer = isEditing ? null : (positionSelection?.layer ?? null);
  const editable = positionSelection !== null || componentSelection !== null;

  const handleSizeChange = useCallback(
    (dimension: "width" | "height", value: number) => {
      if (!editable || !selectionBounds) return;

      const current =
        dimension === "width" ? Bounds.width(selectionBounds) : Bounds.height(selectionBounds);
      if (current === 0) return;

      const factor = value / current;
      if (componentSelection && !isEditing) {
        componentSelection.layer.transformComponents(
          componentSelection,
          "Scale components",
          ({ bounds }) => {
            const localBounds = Bounds.fromXYWH(bounds.x, bounds.y, bounds.width, bounds.height);
            const anchorPoint = anchorToPoint(anchor, localBounds);
            return Mat.Compose(
              Mat.Translate(anchorPoint.x, anchorPoint.y),
              Mat.Compose(Mat.Scale(factor, factor), Mat.Translate(-anchorPoint.x, -anchorPoint.y)),
            );
          },
        );
        return;
      }

      if (!layer) return;

      const anchorPoint = anchorToPoint(anchor, selectionBounds);
      layer.scale(selectedPointIds, factor, factor, anchorPoint);
    },
    [anchor, componentSelection, editable, isEditing, layer, selectedPointIds, selectionBounds],
  );

  const handleScaleChange = useCallback(
    (scale: number) => {
      if (!editable || !selectionBounds) return;

      if (componentSelection && !isEditing) {
        componentSelection.layer.transformComponents(
          componentSelection,
          "Scale components",
          ({ bounds }) => {
            const localBounds = Bounds.fromXYWH(bounds.x, bounds.y, bounds.width, bounds.height);
            const anchorPoint = anchorToPoint(anchor, localBounds);
            return Mat.Compose(
              Mat.Translate(anchorPoint.x, anchorPoint.y),
              Mat.Compose(Mat.Scale(scale, scale), Mat.Translate(-anchorPoint.x, -anchorPoint.y)),
            );
          },
        );
        return;
      }

      if (!layer) return;

      const anchorPoint = anchorToPoint(anchor, selectionBounds);
      layer.scale(selectedPointIds, scale, scale, anchorPoint);
    },
    [anchor, componentSelection, editable, isEditing, layer, selectedPointIds, selectionBounds],
  );

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-ui text-secondary">Size</div>
        <div className="flex gap-2">
          <SidebarNumberField
            ariaLabel="Width"
            label="W"
            value={selectionBounds ? Math.round(Bounds.width(selectionBounds)) : 0}
            disabled={!editable}
            onValueCommit={(v) => handleSizeChange("width", v)}
          />
          <SidebarNumberField
            ariaLabel="Height"
            label="H"
            value={selectionBounds ? Math.round(Bounds.height(selectionBounds)) : 0}
            disabled={!editable}
            onValueCommit={(v) => handleSizeChange("height", v)}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-ui text-secondary">Scale</div>
          <div className="max-w-18">
            <SidebarNumberField
              ariaLabel="Scale factor"
              label={<ScaleIcon className="h-3.5 w-3.5" />}
              value={1}
              suffix="x"
              disabled={!editable}
              onValueCommit={handleScaleChange}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-ui text-secondary">Anchor point</div>
          <div className="w-full h-full bg-input p-1.5 rounded-sm">
            <TransformGrid activeAnchor={anchor} onChange={editable ? setAnchor : undefined} />
          </div>
        </div>
      </div>
    </SidebarSection>
  );
};
