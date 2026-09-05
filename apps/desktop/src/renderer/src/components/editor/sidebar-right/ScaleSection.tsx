import { useCallback, useEffect, useMemo, useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { anchorToPoint } from "@/lib/transform/anchor";
import { useSignalState } from "@/lib/signals";
import { Bounds } from "@shift/geo";
import ScaleIcon from "@/assets/sidebar-right/scale.svg";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { isPointId } from "@shift/types";

export const ScaleSection = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell);
  const { anchor, setAnchor } = useTransformOrigin();
  const selectionBounds = useSelectionBounds();

  const widthRef = useRef<EditableSidebarInputHandle>(null);
  const heightRef = useRef<EditableSidebarInputHandle>(null);
  const selectedPointIds = useMemo(() => selection.ids.filter(isPointId), [selection]);
  const layer = useMemo(
    () => editor.layerForGeometry({ points: selectedPointIds }),
    [editor, selectedPointIds],
  );
  const editable = layer !== null;

  useEffect(() => {
    if (!widthRef.current || !heightRef.current) return;
    if (!selectionBounds) return;

    const width = Bounds.width(selectionBounds);
    const height = Bounds.height(selectionBounds);

    widthRef.current.setValue(Math.round(width));
    heightRef.current.setValue(Math.round(height));
  }, [selectionBounds]);

  const handleSizeChange = useCallback(
    (dimension: "width" | "height", value: number) => {
      if (!layer) return;
      if (!selectionBounds) return;

      const current =
        dimension === "width" ? Bounds.width(selectionBounds) : Bounds.height(selectionBounds);
      if (current === 0) return;

      const factor = value / current;
      const anchorPoint = anchorToPoint(anchor, selectionBounds);
      layer.scale(selectedPointIds, factor, factor, anchorPoint);
    },
    [anchor, layer, selectedPointIds, selectionBounds],
  );

  const handleScaleChange = useCallback(
    (scale: number) => {
      if (!layer) return;
      if (!selectionBounds) return;
      const anchorPoint = anchorToPoint(anchor, selectionBounds);
      layer.scale(selectedPointIds, scale, scale, anchorPoint);
    },
    [anchor, layer, selectedPointIds, selectionBounds],
  );

  return (
    <SidebarSection title="Scale">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-secondary">Size</div>
        <div className="flex gap-2">
          <EditableSidebarInput
            ref={widthRef}
            ariaLabel="Width"
            label={<span className="text-xs text-secondary">W</span>}
            disabled={!editable}
            onValueChange={(v) => handleSizeChange("width", v)}
          />
          <EditableSidebarInput
            ref={heightRef}
            ariaLabel="Height"
            label="H"
            disabled={!editable}
            onValueChange={(v) => handleSizeChange("height", v)}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-secondary">Scale</div>
          <EditableSidebarInput
            ariaLabel="Scale factor"
            className="max-w-18 pl-7"
            value={1}
            suffix="x"
            icon={<ScaleIcon className="w-3.5 h-3.5" />}
            iconPosition="left"
            disabled={!editable}
            onValueChange={handleScaleChange}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs text-secondary">Anchor point</div>
          <div className="w-full h-full bg-input p-1.5 rounded-sm">
            <TransformGrid activeAnchor={anchor} onChange={editable ? setAnchor : undefined} />
          </div>
        </div>
      </div>
    </SidebarSection>
  );
};
