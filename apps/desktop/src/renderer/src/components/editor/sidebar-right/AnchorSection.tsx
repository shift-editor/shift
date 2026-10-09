import { useState } from "react";
import { isAnchorId, type AnchorId } from "@shift/types";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { track } from "@shift/editor/signals";
import { PositionEdits, type GlyphLayer } from "@shift/editor/model";
import { Vec2, type PointAxis } from "@shift/geo";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection } from "./SidebarSection";

export const AnchorSection = () => {
  const editor = useEditor();
  const [anchorId, setAnchorId] = useState<AnchorId | null>(null);
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [layer, setLayer] = useState<GlyphLayer | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

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
      setLayer(null);
      setPosition({ x: 0, y: 0 });
      return;
    }

    setAnchorId(anchor.id);
    setAnchorName(anchor.name ?? null);
    setLayer(object.layer);
    setPosition({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  });

  const handlePositionChange = (axis: PointAxis, value: number) => {
    if (!anchorId || !layer) return;

    const positionSelection = editor.positionSelection([anchorId]);
    const currentAnchor = positionSelection?.layer.anchor(anchorId);
    if (!positionSelection || !currentAnchor) return;

    const delta = Vec2.fromAxis(axis, value - currentAnchor[axis]);
    const move = PositionEdits.fromSelection(positionSelection).move(positionSelection.targets);
    move.preview(delta);
    move.commit("Move anchor");
  };

  const editable = anchorId !== null && layer !== null;

  return (
    <SidebarSection title="Anchor">
      <div className="text-ui text-secondary">{anchorName ?? "Unnamed anchor"}</div>
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Anchor X position"
          label="X"
          value={position.x}
          disabled={!editable}
          onValueCommit={(value) => handlePositionChange("x", value)}
        />
        <SidebarNumberField
          ariaLabel="Anchor Y position"
          label="Y"
          value={position.y}
          disabled={!editable}
          onValueCommit={(value) => handlePositionChange("y", value)}
        />
      </div>
    </SidebarSection>
  );
};
