import { useRef, useState } from "react";
import type { Point2D } from "@shift/geo";
import { isAnchorId, type AnchorId } from "@shift/types";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";

export const AnchorSection = () => {
  const editor = useEditor();
  const [anchorId, setAnchorId] = useState<AnchorId | null>(null);
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [anchorPosition, setAnchorPosition] = useState<Point2D | null>(null);
  const [layer, setLayer] = useState<GlyphLayer | null>(null);
  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    track(editor.externalLocationCell);
    track(editor.activeSourceIdCell);
    const selection = editor.selection.stateCell.value;
    const selectedId = selection.ids.length === 1 ? selection.ids[0] : null;
    const object = selectedId && isAnchorId(selectedId) ? editor.object(selectedId) : null;
    const anchor = object?.kind === "anchor" ? object.geometry.anchor(object.anchorId) : null;
    if (!object || object.kind !== "anchor" || !anchor) {
      setAnchorId(null);
      setAnchorName(null);
      setAnchorPosition(null);
      setLayer(null);
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    setAnchorId(anchor.id);
    setAnchorName(anchor.name ?? null);
    setAnchorPosition({ x: anchor.x, y: anchor.y });
    setLayer(object.layer);
    xRef.current?.setValue(Math.round(anchor.x));
    yRef.current?.setValue(Math.round(anchor.y));
  });

  const handlePositionChange = (axis: "x" | "y", value: number) => {
    if (!anchorId || !anchorPosition || !layer) return;

    const next =
      axis === "x" ? { x: value, y: anchorPosition.y } : { x: anchorPosition.x, y: value };
    layer.applyPositionPatch([{ kind: "anchor", id: anchorId, ...next }]);
  };

  const editable = anchorId !== null && layer !== null;

  return (
    <SidebarSection title="Anchor">
      <div className="text-xs text-secondary">{anchorName ?? "Unnamed anchor"}</div>
      <div className="flex gap-2">
        <EditableSidebarInput
          ref={xRef}
          label="X"
          disabled={!editable}
          onValueChange={(value) => handlePositionChange("x", value)}
        />
        <EditableSidebarInput
          ref={yRef}
          label="Y"
          disabled={!editable}
          onValueChange={(value) => handlePositionChange("y", value)}
        />
      </div>
    </SidebarSection>
  );
};
