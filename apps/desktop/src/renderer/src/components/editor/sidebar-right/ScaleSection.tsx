import { useCallback, useEffect, useMemo, useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { TransformGrid } from "./TransformGrid";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { useTransformOrigin } from "@/context/TransformOriginContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { anchorToPoint } from "@/lib/transform/anchor";
import { useSignalState } from "@/lib/signals";
import { Bounds } from "@shift/geo";
import ScaleIcon from "@/assets/sidebar-right/scale.svg";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { isPointId } from "@shift/types";

export const ScaleSection = () => {
  const editor = useEditor();
  const sourceId = useActiveSourceId();
  const scene = useSignalState(editor.scene.cell);
  const selection = useSignalState(editor.selection.stateCell);
  const { anchor, setAnchor } = useTransformOrigin();
  const selectionBounds = useSelectionBounds();

  const widthRef = useRef<EditableSidebarInputHandle>(null);
  const heightRef = useRef<EditableSidebarInputHandle>(null);
  const layer = useMemo(() => {
    if (!sourceId) return null;

    const glyphNodes = scene.nodes.filter((node) => node.kind === "glyph");
    if (glyphNodes.length !== 1) return null;

    const [node] = glyphNodes;
    if (!node) return null;

    return editor.font.layer(node.glyphId, sourceId);
  }, [editor, scene, sourceId]);
  const selectedPointIds = useMemo(() => selection.ids.filter(isPointId), [selection]);

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
